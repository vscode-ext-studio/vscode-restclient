import * as fs from 'fs-extra';
import * as iconv from 'iconv-lite';
import * as path from 'path';
import { Cookie, CookieJar, Store } from 'tough-cookie';
import * as url from 'url';
import { Uri, window } from 'vscode';
import { RequestHeaders, ResponseHeaders } from '../models/base';
import { RestClientSettings } from '../models/configurationSettings';
import { HttpRequest } from '../models/httpRequest';
import { HttpResponse } from '../models/httpResponse';
import { MimeUtility } from './mimeUtility';
import { getHeader, hasHeader, removeHeader } from './misc';
import { convertBufferToStream, convertStreamToBuffer } from './streamUtility';
import { UserDataManager } from './userDataManager';
import { getCurrentHttpFileName, getWorkspaceRootPath } from './workspaceUtility';

import axios, { AxiosResponse } from 'axios';
import { Agent } from 'https';

const encodeUrl = require('encodeurl');
const cookieStore = require('tough-cookie-file-store-bugfix');

type SetCookieCallback = (err: Error | null, cookie: Cookie) => void;
type SetCookieCallbackWithoutOptions = (err: Error, cookie: Cookie) => void;
type GetCookieStringCallback = (err: Error | null, cookies: string) => void;
type Certificate = {
    cert?: Buffer;
    key?: Buffer;
    pfx?: Buffer;
    passphrase?: string;
};

interface RequestOption {
    method: string;
    headers: RequestHeaders;
    body?: string | Buffer;
    encoding?: null;
    decompress?: boolean;
    followRedirect?: boolean;
    retry?: number;
    rejectUnauthorized?: boolean;
    throwHttpErrors?: boolean;
    cookieJar?: CookieJar;
    timeout?: number | { connect: number; socket: number; response: number; send: number };
    agent?: any;
}

export class HttpClient {
    private readonly _settings: RestClientSettings = RestClientSettings.Instance;

    private readonly cookieStore: Store;

    public constructor() {
        const cookieFilePath = UserDataManager.cookieFilePath;
        this.cookieStore = new cookieStore(cookieFilePath) as Store;
    }

    public async send(httpRequest: HttpRequest): Promise<HttpResponse> {
        const options = await this.prepareOptions(httpRequest);
        const { method, headers, body } = options;

        let bodySize = 0;
        let headersSize = 0;
        const requestUrl = encodeUrl(httpRequest.url);
        const startDate = new Date().getTime();
        const req = axios.request({
            url: requestUrl, method: method as any, headers: headers, data: body, responseType: "arraybuffer", httpsAgent: new Agent({
                rejectUnauthorized: false,
            })
        }).catch(err => {
            if (!err.response) throw err;
            return err.response;
        });
        const response: AxiosResponse = await req;

        const contentType = response.headers['content-type'];
        let encoding: string | undefined;
        if (contentType) {
            encoding = MimeUtility.parse(contentType).charset;
        }

        if (!encoding) {
            encoding = "utf8";
        }

        const bodyBuffer = response.data;
        let bodyString = iconv.encodingExists(encoding) ? iconv.decode(bodyBuffer, encoding) : bodyBuffer.toString();

        if (this._settings.decodeEscapedUnicodeCharacters) {
            bodyString = this.decodeEscapedUnicodeCharacters(bodyString);
        }

        // adjust response header case, due to the response headers in nodejs http module is in lowercase
        const responseHeaders: ResponseHeaders = response.headers;

        const requestBody = body;

        return new HttpResponse(
            response.status,
            response.statusText,
            '1.1',
            responseHeaders,
            bodyString,
            bodySize,
            headersSize,
            bodyBuffer,
            {
                total: new Date().getTime() - startDate
            } as any,
            new HttpRequest(
                method!,
                requestUrl,
                HttpClient.normalizeHeaderNames(
                    httpRequest.headers,
                    Object.keys(httpRequest.headers)),
                Buffer.isBuffer(requestBody) ? convertBufferToStream(requestBody) : requestBody,
                httpRequest.rawBody,
                httpRequest.name
            ));
    }

    private async prepareOptions(httpRequest: HttpRequest): Promise<RequestOption> {
        const originalRequestBody = httpRequest.body;
        let requestBody: string | Buffer | undefined;
        if (originalRequestBody) {
            if (typeof originalRequestBody !== 'string') {
                requestBody = await convertStreamToBuffer(originalRequestBody);
            } else {
                requestBody = originalRequestBody;
            }
        }

        // Fix #682 Do not touch original headers in httpRequest, which may be used for retry later
        // Simply do a shadow copy here
        const clonedHeaders = Object.assign({}, httpRequest.headers);
        const options: RequestOption = {
            headers: clonedHeaders,
            method: httpRequest.method,
            body: requestBody,
            encoding: null,
            decompress: true,
            followRedirect: this._settings.followRedirect,
            rejectUnauthorized: false,
            throwHttpErrors: false,
            cookieJar: this._settings.rememberCookiesForSubsequentRequests ? new CookieJar(this.cookieStore, { rejectPublicSuffixes: false }) : undefined,
            retry: 0,
        };

        if (this._settings.timeoutInMilliseconds > 0) {
            options.timeout = this._settings.timeoutInMilliseconds;
        }

        // TODO: refactor auth
        const authorization = getHeader(options.headers!, 'Authorization') as string | undefined;
        if (authorization) {
            const [scheme, user, ...args] = authorization.split(/\s+/);
            const normalizedScheme = scheme.toLowerCase();
            if (args.length > 0) {
                const pass = args.join(' ');
                if (normalizedScheme === 'basic') {
                    removeHeader(options.headers!, 'Authorization');
                    options.auth = `${user}:${pass}`;
                }
            } else if (normalizedScheme === 'basic' && user.includes(':')) {
                removeHeader(options.headers!, 'Authorization');
                options.auth = user;
            }
        }

        // set certificate
        const certificate = this.getRequestCertificate(httpRequest.url);
        Object.assign(options, certificate);

        // set proxy
        if (this._settings.proxy && !HttpClient.ignoreProxy(httpRequest.url, this._settings.excludeHostsForProxy)) {
            const proxyEndpoint = url.parse(this._settings.proxy);
            if (/^https?:$/.test(proxyEndpoint.protocol || '')) {
                const proxyOptions = {
                    host: proxyEndpoint.hostname,
                    port: Number(proxyEndpoint.port),
                    rejectUnauthorized: this._settings.proxyStrictSSL
                };

                const ctor = (httpRequest.url.startsWith('http:')
                    ? await import('http-proxy-agent')
                    : await import('https-proxy-agent')).default;

                options.agent = new ctor(proxyOptions);
            }
        }

        // set cookie jar
        if (options.cookieJar) {
            const { getCookieString: originalGetCookieString, setCookie: originalSetCookie } = options.cookieJar;

            function _setCookie(cookieOrString: Cookie | string, currentUrl: string, opts: CookieJar.SetCookieOptions, cb: SetCookieCallback): void;
            function _setCookie(cookieOrString: Cookie | string, currentUrl: string, cb: SetCookieCallbackWithoutOptions): void;
            function _setCookie(cookieOrString: Cookie | string, currentUrl: string, opts: CookieJar.SetCookieOptions | SetCookieCallbackWithoutOptions, cb?: SetCookieCallback): void {
                if (opts instanceof Function) {
                    cb = opts;
                    opts = {};
                }
                opts.ignoreError = true;
                originalSetCookie.call(options.cookieJar, cookieOrString, currentUrl, opts, cb!);
            }
            options.cookieJar.setCookie = _setCookie;

            if (hasHeader(options.headers!, 'cookie')) {
                let count = 0;

                function _getCookieString(currentUrl: string, opts: CookieJar.GetCookiesOptions, cb: GetCookieStringCallback): void;
                function _getCookieString(currentUrl: string, cb: GetCookieStringCallback): void;
                function _getCookieString(currentUrl: string, opts: CookieJar.GetCookiesOptions | GetCookieStringCallback, cb?: GetCookieStringCallback): void {
                    if (opts instanceof Function) {
                        cb = opts;
                        opts = {};
                    }

                    originalGetCookieString.call(options.cookieJar, currentUrl, opts, (err, cookies) => {
                        if (err || count > 0 || !cookies) {
                            cb!(err, cookies);
                        }

                        count++;
                        cb!(null, [cookies, getHeader(options.headers!, 'cookie')].filter(Boolean).join('; '));
                    });
                }
                options.cookieJar.getCookieString = _getCookieString;
            }
        }

        return options;
    }

    private decodeEscapedUnicodeCharacters(body: string): string {
        return body.replace(/\\u([0-9a-fA-F]{4})/gi, (_, g) => {
            const char = String.fromCharCode(parseInt(g, 16));
            return char === '"' ? '\\"' : char;
        });
    }

    private getRequestCertificate(requestUrl: string): Certificate | null {
        const host = url.parse(requestUrl).host;
        if (!host || !(host in this._settings.hostCertificates)) {
            return null;
        }

        const { cert: certPath, key: keyPath, pfx: pfxPath, passphrase } = this._settings.hostCertificates[host];
        const cert = this.resolveCertificate(certPath);
        const key = this.resolveCertificate(keyPath);
        const pfx = this.resolveCertificate(pfxPath);
        return { cert, key, pfx, passphrase };
    }

    private static ignoreProxy(requestUrl: string, excludeHostsForProxy: string[]): Boolean {
        if (!excludeHostsForProxy || excludeHostsForProxy.length === 0) {
            return false;
        }

        const resolvedUrl = url.parse(requestUrl);
        const hostName = resolvedUrl.hostname?.toLowerCase();
        const port = resolvedUrl.port;
        const excludeHostsProxyList = Array.from(new Set(excludeHostsForProxy.map(eh => eh.toLowerCase())));

        for (const eh of excludeHostsProxyList) {
            const urlParts = eh.split(":");
            if (!port) {
                // if no port specified in request url, host name must exactly match
                if (urlParts.length === 1 && urlParts[0] === hostName) {
                    return true;
                }
            } else {
                // if port specified, match host without port or hostname:port exactly match
                const [ph, pp] = urlParts;
                if (ph === hostName && (!pp || pp === port)) {
                    return true;
                }
            }
        }

        return false;
    }

    private resolveCertificate(absoluteOrRelativePath: string | undefined): Buffer | undefined {
        if (absoluteOrRelativePath === undefined) {
            return undefined;
        }

        if (path.isAbsolute(absoluteOrRelativePath)) {
            if (!fs.existsSync(absoluteOrRelativePath)) {
                window.showWarningMessage(`Certificate path ${absoluteOrRelativePath} doesn't exist, please make sure it exists.`);
                return undefined;
            } else {
                return fs.readFileSync(absoluteOrRelativePath);
            }
        }

        // the path should be relative path
        const rootPath = getWorkspaceRootPath();
        let absolutePath = '';
        if (rootPath) {
            absolutePath = path.join(Uri.parse(rootPath).fsPath, absoluteOrRelativePath);
            if (fs.existsSync(absolutePath)) {
                return fs.readFileSync(absolutePath);
            } else {
                window.showWarningMessage(`Certificate path ${absoluteOrRelativePath} doesn't exist, please make sure it exists.`);
                return undefined;
            }
        }

        const currentFilePath = getCurrentHttpFileName();
        if (!currentFilePath) {
            return undefined;
        }

        absolutePath = path.join(path.dirname(currentFilePath), absoluteOrRelativePath);
        if (fs.existsSync(absolutePath)) {
            return fs.readFileSync(absolutePath);
        } else {
            window.showWarningMessage(`Certificate path ${absoluteOrRelativePath} doesn't exist, please make sure it exists.`);
            return undefined;
        }
    }

    private static normalizeHeaderNames<T extends RequestHeaders | ResponseHeaders>(headers: T, rawHeaders: string[]): T {
        const headersDic: { [key: string]: string } = rawHeaders.reduce(
            (prev, cur) => {
                if (!(cur.toLowerCase() in prev)) {
                    prev[cur.toLowerCase()] = cur;
                }
                return prev;
            }, {});
        const adjustedResponseHeaders = {} as RequestHeaders | ResponseHeaders;
        for (const header in headers) {
            const adjustedHeaderName = headersDic[header] || header;
            adjustedResponseHeaders[adjustedHeaderName] = headers[header];
        }

        return adjustedResponseHeaders as T;
    }
}
