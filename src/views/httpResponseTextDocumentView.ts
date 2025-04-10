import { EOL } from 'os';
import { commands, languages, Position, Range, TextDocument, Uri, ViewColumn, window, workspace, env } from 'vscode';
import { RequestHeaders, ResponseHeaders } from '../models/base';
import { RestClientSettings } from '../models/configurationSettings';
import { HttpResponse } from '../models/httpResponse';
import { PreviewOption } from '../models/previewOption';
import { MimeUtility } from '../utils/mimeUtility';
import { ResponseFormatUtility } from '../utils/responseFormatUtility';
import { HttpResponseTextDocumentContentProvider } from './httpResponseTextDocumentContentProvider';
import * as fs from 'fs';
import { UserDataManager } from '../utils/userDataManager';

const OPEN = 'Open';
const COPYPATH = 'Copy Path';

export class HttpResponseTextDocumentView {
    private readonly settings: RestClientSettings = RestClientSettings.Instance;
    private readonly contentProvider: HttpResponseTextDocumentContentProvider;
    private readonly scheme = 'rest-client-response';
    private readonly responseUri: Uri;
    private currentResponse: HttpResponse | undefined;

    public constructor() {
        this.contentProvider = new HttpResponseTextDocumentContentProvider();
        workspace.registerTextDocumentContentProvider(this.scheme, this.contentProvider);
        this.responseUri = Uri.parse(`${this.scheme}://response/Response`);

        // 注册命令
        commands.registerCommand('vscode-office.copy-response-body', this.copyBody, this);
        commands.registerCommand('vscode-office.save-response-body', this.saveBody, this);
    }

    public async render(response: HttpResponse, column?: ViewColumn) {
        const language = this.getVSCodeDocumentLanguageId(response);

        this.currentResponse = response;
        this.contentProvider.update(this.responseUri, response);
        const document = await workspace.openTextDocument(this.responseUri);
        languages.setTextDocumentLanguage(document, language);
        await window.showTextDocument(document, { viewColumn: column, preserveFocus: true, preview: false });
    }

    private async copyBody() {
        if (this.currentResponse) {
            const formattedBody = ResponseFormatUtility.formatBody(this.currentResponse.body, this.currentResponse.contentType, true);
            await env.clipboard.writeText(formattedBody);
            window.showInformationMessage('Copied to clipboard');
        }
    }

    private async saveBody() {
        if (this.currentResponse) {
            let extension = MimeUtility.getExtension(this.currentResponse.contentType);
            if (!extension) {
                const url = this.currentResponse.request.url;
                const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
                if (match) {
                    extension = match[1];
                }
            }
            const fileName = !extension ? `Response-${Date.now()}` : `Response-${Date.now()}.${extension}`;
            const defaultFilePath = UserDataManager.getResponseBodySaveFilePath(fileName);
            try {
                await this.openSaveDialog(defaultFilePath, this.currentResponse.bodyBuffer);
            } catch {
                window.showErrorMessage('Failed to save latest response body to disk');
            }
        }
    }

    private async openSaveDialog(path: string, content: string | Buffer) {
        const uri = await window.showSaveDialog({ defaultUri: Uri.file(path) });
        if (!uri) {
            return;
        }

        const filePath = uri.fsPath;
        await fs.writeFileSync(filePath, content, { flag: 'w' });
        const btn = await window.showInformationMessage(`Saved to ${filePath}`, { title: OPEN }, { title: COPYPATH });
        if (btn?.title === OPEN) {
            workspace.openTextDocument(filePath).then(window.showTextDocument);
        } else if (btn?.title === COPYPATH) {
            await env.clipboard.writeText(filePath);
        }
    }

    private getVSCodeDocumentLanguageId(response: HttpResponse) {
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