import * as url from 'url';
import { RequestHeaders, ResponseHeaders } from '../models/base';
import { RestClientSettings } from '../models/configurationSettings';
import { HttpRequest } from '../models/httpRequest';
import { HttpResponse } from '../models/httpResponse';
import { MimeUtility } from './mimeUtility';
import { getHeader, removeHeader } from './misc';
import { convertBufferToStream, convertStreamToBuffer } from './streamUtility';

import axios, { AxiosResponse } from 'axios';
import { Agent } from 'https';

const encodeUrl = require('encodeurl');

interface RequestOption {
    method: string;
    headers: RequestHeaders;
    body?: string | Buffer;
    auth?: string;
    encoding?: null;
    decompress?: boolean;
    followRedirect?: boolean;
    retry?: number;
    rejectUnauthorized?: boolean;
    throwHttpErrors?: boolean;
    timeout?: number | { connect: number; socket: number; response: number; send: number };
    agent?: any;
}

export class HttpClient {
    private readonly _settings: RestClientSettings = RestClientSettings.Instance;

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
        let bodyString = bodyBuffer.toString();

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

        return options;
    }

    private decodeEscapedUnicodeCharacters(body: string): string {
        return body.replace(/\\u([0-9a-fA-F]{4})/gi, (_, g) => {
            const char = String.fromCharCode(parseInt(g, 16));
            return char === '"' ? '\\"' : char;
        });
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
