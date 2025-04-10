'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { commands, ExtensionContext, languages, Range, TextDocument, Uri, window, workspace } from 'vscode';
import { CodeSnippetController } from './controllers/codeSnippetController';
import { RequestController } from './controllers/requestController';
import { CustomVariableDiagnosticsProvider } from "./providers/customVariableDiagnosticsProvider";
import { RequestBodyDocumentLinkProvider } from './providers/documentLinkProvider';
import { EnvironmentOrFileVariableHoverProvider } from './providers/environmentOrFileVariableHoverProvider';
import { FileVariableDefinitionProvider } from './providers/fileVariableDefinitionProvider';
import { FileVariableReferenceProvider } from './providers/fileVariableReferenceProvider';
import { FileVariableReferencesCodeLensProvider } from './providers/fileVariableReferencesCodeLensProvider';
import { HttpCodeLensProvider } from './providers/httpCodeLensProvider';
import { HttpCompletionItemProvider } from './providers/httpCompletionItemProvider';
import { HttpDocumentSymbolProvider } from './providers/httpDocumentSymbolProvider';
import { RequestVariableCompletionItemProvider } from "./providers/requestVariableCompletionItemProvider";
import { RequestVariableDefinitionProvider } from './providers/requestVariableDefinitionProvider';
import { RequestVariableHoverProvider } from './providers/requestVariableHoverProvider';
import { ConfigurationDependentRegistration } from './utils/dependentRegistration';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {
    const requestController = new RequestController(context);
    const codeSnippetController = new CodeSnippetController();
    context.subscriptions.push(requestController);
    context.subscriptions.push(codeSnippetController);
    context.subscriptions.push(commands.registerCommand('vscode-office.request', ((document: TextDocument, range: Range) => requestController.run(range))));
    context.subscriptions.push(commands.registerCommand('vscode-office.cancel-request', () => requestController.cancel()));
    context.subscriptions.push(commands.registerCommand('vscode-office.copy-request-as-curl', () => codeSnippetController.copyAsCurl()));
    context.subscriptions.push(commands.registerCommand('vscode-office._openDocumentLink', args => {
        workspace.openTextDocument(Uri.parse(args.path)).then(window.showTextDocument, error => {
            window.showErrorMessage(error.message);
        });
    }));

    const documentSelector = [
        { language: 'http', scheme: '*' }
    ];

    context.subscriptions.push(languages.registerCompletionItemProvider(documentSelector, new HttpCompletionItemProvider()));
    context.subscriptions.push(languages.registerCompletionItemProvider(documentSelector, new RequestVariableCompletionItemProvider(), '.'));
    context.subscriptions.push(languages.registerHoverProvider(documentSelector, new EnvironmentOrFileVariableHoverProvider()));
    context.subscriptions.push(languages.registerHoverProvider(documentSelector, new RequestVariableHoverProvider()));
    context.subscriptions.push(languages.registerCodeLensProvider(documentSelector, new HttpCodeLensProvider()));
    context.subscriptions.push(
        new ConfigurationDependentRegistration(
            () => languages.registerCodeLensProvider(documentSelector, new FileVariableReferencesCodeLensProvider()),
            s => s.enableCustomVariableReferencesCodeLens));
    context.subscriptions.push(languages.registerDocumentLinkProvider(documentSelector, new RequestBodyDocumentLinkProvider()));
    context.subscriptions.push(languages.registerDefinitionProvider(documentSelector, new FileVariableDefinitionProvider()));
    context.subscriptions.push(languages.registerDefinitionProvider(documentSelector, new RequestVariableDefinitionProvider()));
    context.subscriptions.push(languages.registerReferenceProvider(documentSelector, new FileVariableReferenceProvider()));
    context.subscriptions.push(languages.registerDocumentSymbolProvider(documentSelector, new HttpDocumentSymbolProvider()));

    const diagnosticsProvider = new CustomVariableDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
