import { CancellationToken, Disposable, Event, EventEmitter, ProviderResult, TextDocumentContentProvider, Uri, workspace } from 'vscode';
import { HttpResponse } from '../models/httpResponse';
import { RestClientSettings } from '../models/configurationSettings';
import { PreviewOption } from '../models/previewOption';
import { EOL } from 'os';
import { ResponseFormatUtility } from '../utils/responseFormatUtility';
import { MimeUtility } from '../utils/mimeUtility';
import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';

export class HttpResponseTextDocumentContentProvider implements TextDocumentContentProvider {
    private readonly settings: RestClientSettings = RestClientSettings.Instance;
    private readonly _onDidChange = new EventEmitter<Uri>();
    private readonly _responses = new Map<string, HttpResponse>();

    public get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    public provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string> {
        const response = this._responses.get(uri.toString());
        if (!response) {
            return '';
        }

        return this.getTextDocumentContent(response);
    }

    public update(uri: Uri, response: HttpResponse): void {
        this._responses.set(uri.toString(), response);
        this._onDidChange.fire(uri);
    }

    public clear(uri: Uri): void {
        this._responses.delete(uri.toString());
        this._onDidChange.fire(uri);
    }

    private getTextDocumentContent(response: HttpResponse): string {
        let content = '';
        const previewOption = this.settings.previewOption;
        if (previewOption === PreviewOption.Exchange) {
            // for add request details
            const request = response.request;
            content += `${request.method} ${request.url} HTTP/1.1${EOL}`;
            content += this.formatHeaders(request.headers as OutgoingHttpHeaders);
            if (request.body) {
                if (typeof request.body !== 'string') {
                    request.body = 'NOTE: Request Body From Is File Not Shown';
                }
                content += `${EOL}${ResponseFormatUtility.formatBody(request.body.toString(), request.contentType, true)}${EOL}`;
            }

            content += EOL.repeat(2);
        }

        if (previewOption !== PreviewOption.Body) {
            content += `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}${EOL}`;
            content += this.formatHeaders(response.headers as IncomingHttpHeaders);
        }

        if (previewOption !== PreviewOption.Headers) {
            const prefix = previewOption === PreviewOption.Body ? '' : EOL;
            content += `${prefix}${ResponseFormatUtility.formatBody(response.body, response.contentType, true)}`;
        }

        return content;
    }

    private formatHeaders(headers: OutgoingHttpHeaders | IncomingHttpHeaders): string {
        let headerString = '';
        for (const header in headers) {
            const value = headers[header];
            if (value) {
                headerString += `${header}: ${Array.isArray(value) ? value.join(', ') : value}${EOL}`;
            }
        }
        return headerString;
    }

    public getVSCodeDocumentLanguageId(response: HttpResponse): string {
        if (this.settings.previewOption === PreviewOption.Body) {
            const contentType = response.contentType;
            if (MimeUtility.isJSON(contentType)) {
                return 'json';
            } else if (MimeUtility.isJavaScript(contentType)) {
                return 'javascript';
            } else if (MimeUtility.isXml(contentType)) {
                return 'xml';
            } else if (MimeUtility.isHtml(contentType)) {
                return 'html';
            } else if (MimeUtility.isCSS(contentType)) {
                return 'css';
            }
        }

        return 'http';
    }
} 