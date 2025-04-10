import { HttpRequest } from './httpRequest';

export interface RequestParser {
    parseHttpRequest(name?: string, withHeader?: boolean): Promise<HttpRequest>;
}