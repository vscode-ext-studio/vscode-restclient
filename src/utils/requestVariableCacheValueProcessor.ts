import { HttpRequest } from "../models/httpRequest";
import { HttpResponse } from '../models/httpResponse';
import { ResolveErrorMessage, ResolveResult, ResolveState, ResolveWarningMessage } from "../models/httpVariableResolveResult";
import { MimeUtility } from './mimeUtility';
import { getContentType, getHeader, isJSONString } from './misc';

const { JSONPath } = require('jsonpath-plus');

const requestVariablePathRegex: RegExp = /^(\w+)(?:\.(request|response)(?:\.(body|headers)(?:\.(.*))?)?)?$/;

type HttpEntity = 'request' | 'response';
type HttpPart = 'headers' | 'body';

export class RequestVariableCacheValueProcessor {
    public static resolveRequestVariable(value: HttpResponse | undefined, path: string): ResolveResult {
        if (!value || !path) {
            return { state: ResolveState.Error, message: ResolveErrorMessage.NoRequestVariablePath };
        }

        const matches = path.match(requestVariablePathRegex);

        if (!matches) {
            return { state: ResolveState.Error, message: ResolveErrorMessage.InvalidRequestVariableReference };
        }

        const [, , type, httpPart, nameOrPath] = matches;

        if (!type) {
            return { state: ResolveState.Warning, value, message: ResolveWarningMessage.MissingRequestEntityName };
        }

        const httpEntity = (type as HttpEntity) === 'request' ? value.request : value;

        if (!httpPart) {
            return { state: ResolveState.Warning, value: httpEntity, message: ResolveWarningMessage.MissingRequestEntityPart };
        }

        return this.resolveHttpPart(httpEntity, httpPart as HttpPart, nameOrPath);
    }

    private static resolveHttpPart(http: HttpRequest | HttpResponse, httpPart: HttpPart, nameOrPath?: string): ResolveResult {
        if (httpPart === "body") {
            const { body, headers } = http;
            if (!body) {
                const message = http instanceof HttpRequest ? ResolveWarningMessage.RequestBodyNotExist : ResolveWarningMessage.ResponseBodyNotExist;
                return { state: ResolveState.Warning, message };
            }

            if (!nameOrPath) {
                return { state: ResolveState.Warning, value: body, message: ResolveWarningMessage.MissingBodyPath };
            }

            // Make '*' as the wildcard to fetch the whole body regardless of the content-type
            if (nameOrPath === '*') {
                return { state: ResolveState.Success, value: body };
            }

            const contentTypeHeader = getContentType(headers);
            if (MimeUtility.isJSON(contentTypeHeader) || (MimeUtility.isJavaScript(contentTypeHeader) && isJSONString(body as string))) {
                const parsedBody = JSON.parse(body as string);

                return this.resolveJsonHttpBody(parsedBody, nameOrPath);
            } else {
                return { state: ResolveState.Warning, value: body, message: ResolveWarningMessage.UnsupportedBodyContentType };
            }

        } else {
            const { headers } = http;
            if (!nameOrPath) {
                return { state: ResolveState.Warning, value: headers, message: ResolveWarningMessage.MissingHeaderName };
            }

            const value = getHeader(headers, nameOrPath);
            if (!value) {
                return { state: ResolveState.Warning, message: ResolveWarningMessage.IncorrectHeaderName };
            } else {
                return { state: ResolveState.Success, value };
            }
        }
    }

    private static resolveJsonHttpBody(body: any, path: string): ResolveResult {
        try {
            const result = JSONPath({ path, json: body });
            const value = typeof result[0] === 'string' ? result[0] : JSON.stringify(result[0]);
            if (!value) {
                return { state: ResolveState.Warning, message: ResolveWarningMessage.IncorrectJSONPath };
            } else {
                return { state: ResolveState.Success, value };
            }
        } catch {
            return { state: ResolveState.Warning, message: ResolveWarningMessage.InvalidJSONPath };
        }
    }

}

const enum NodeType {
    Element = 1,
    Attribute = 2,
    Document = 9,
}