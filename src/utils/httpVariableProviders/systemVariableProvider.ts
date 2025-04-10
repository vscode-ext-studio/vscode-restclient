import dayjs, { Dayjs, OpUnitType } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import * as dotenv from 'dotenv';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Clipboard, commands, env, QuickPickItem, QuickPickOptions, TextDocument, Uri, window } from 'vscode';
import * as Constants from '../../common/constants';
import { HttpRequest } from '../../models/httpRequest';
import { ResolveErrorMessage, ResolveWarningMessage } from '../../models/httpVariableResolveResult';
import { VariableType } from '../../models/variableType';
import { AadV2TokenProvider } from '../aadV2TokenProvider';
import { HttpClient } from '../httpClient';
import { EnvironmentVariableProvider } from './environmentVariableProvider';
import { HttpVariable, HttpVariableContext, HttpVariableProvider } from './httpVariableProvider';

const uuidv4 = require('uuid/v4');

dayjs.extend(utc);

type SystemVariableValue = Pick<HttpVariable, Exclude<keyof HttpVariable, 'name'>>;
type ResolveSystemVariableFunc = (name: string, document: TextDocument, context: HttpVariableContext) => Promise<SystemVariableValue>;

export class SystemVariableProvider implements HttpVariableProvider {

    private readonly clipboard: Clipboard;
    private readonly resolveFuncs: Map<string, ResolveSystemVariableFunc> = new Map<string, ResolveSystemVariableFunc>();
    private readonly timestampRegex: RegExp = new RegExp(`\\${Constants.TimeStampVariableName}(?:\\s(\\-?\\d+)\\s(y|Q|M|w|d|h|m|s|ms))?`);
    private readonly datetimeRegex: RegExp = new RegExp(`\\${Constants.DateTimeVariableName}\\s(rfc1123|iso8601|\'.+\'|\".+\")(?:\\s(\\-?\\d+)\\s(y|Q|M|w|d|h|m|s|ms))?`);
    private readonly localDatetimeRegex: RegExp = new RegExp(`\\${Constants.LocalDateTimeVariableName}\\s(rfc1123|iso8601|\'.+\'|\".+\")(?:\\s(\\-?\\d+)\\s(y|Q|M|w|d|h|m|s|ms))?`);
    private readonly randomIntegerRegex: RegExp = new RegExp(`\\${Constants.RandomIntVariableName}\\s(\\-?\\d+)\\s(\\-?\\d+)`);
    private readonly processEnvRegex: RegExp = new RegExp(`\\${Constants.ProcessEnvVariableName}\\s(\\%)?(\\w+)`);

    private readonly dotenvRegex: RegExp = new RegExp(`\\${Constants.DotenvVariableName}\\s(\\%)?([\\w-.]+)`);

    private readonly requestUrlRegex: RegExp = /^(?:[^\s]+\s+)([^:]*:\/\/\/?[^/\s]*\/?)/;

    private readonly aadRegex: RegExp = new RegExp(`\\s*\\${Constants.AzureActiveDirectoryVariableName}(\\s+(${Constants.AzureActiveDirectoryForceNewOption}))?(\\s+(ppe|public|cn|de|us))?(\\s+([^\\.]+\\.[^\\}\\s]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?(\\s+aud:([^\\.]+\\.[^\\}\\s]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))?\\s*`);

    private readonly innerSettingsEnvironmentVariableProvider: EnvironmentVariableProvider = EnvironmentVariableProvider.Instance;
    private static _instance: SystemVariableProvider;

    public static get Instance(): SystemVariableProvider {
        if (!this._instance) {
            this._instance = new SystemVariableProvider();
        }

        return this._instance;
    }

    private constructor() {
        this.clipboard = env.clipboard;
        this.registerTimestampVariable();
        this.registerDateTimeVariable();
        this.registerLocalDateTimeVariable();
        this.registerGuidVariable();
        this.registerRandomIntVariable();
        this.registerProcessEnvVariable();
        this.registerDotenvVariable();
        this.registerAadV2TokenVariable();
    }

    public readonly type: VariableType = VariableType.System;

    public async has(name: string, document: TextDocument): Promise<boolean> {
        const [variableName] = name.split(' ').filter(Boolean);
        return this.resolveFuncs.has(variableName);
    }

    public async get(name: string, document: TextDocument, context: HttpVariableContext): Promise<HttpVariable> {
        const [variableName] = name.split(' ').filter(Boolean);
        if (!this.resolveFuncs.has(variableName)) {
            return { name: variableName, error: ResolveErrorMessage.SystemVariableNotExist };
        }

        const result = await this.resolveFuncs.get(variableName)!(name, document, context);
        return { name: variableName, ...result };
    }

    public async getAll(document: undefined, context: HttpVariableContext): Promise<HttpVariable[]> {
        return [...this.resolveFuncs.keys()].map(name => ({ name }));
    }

    private registerTimestampVariable() {
        this.resolveFuncs.set(Constants.TimeStampVariableName, async name => {
            const groups = this.timestampRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const [, offset, option] = groups;
                const ts = offset && option
                    ? dayjs.utc().add(+offset, option as OpUnitType).unix()
                    : dayjs.utc().unix();
                return { value: ts.toString() };
            }

            return { warning: ResolveWarningMessage.IncorrectTimestampVariableFormat };
        });
    }

    private registerDateTimeVariable() {
        this.resolveFuncs.set(Constants.DateTimeVariableName, async name => {
            const groups = this.datetimeRegex.exec(name);
            if (groups !== null && groups.length === 4) {
                const [, type, offset, option] = groups;
                let date: Dayjs;
                if (offset && option) {
                    date = dayjs.utc().add(+offset, option as OpUnitType);
                } else {
                    date = dayjs.utc();
                }

                if (type === 'rfc1123') {
                    return { value: date.toDate().toUTCString() };
                } else if (type === 'iso8601') {
                    return { value: date.toISOString() };
                } else {
                    return { value: date.format(type.slice(1, type.length - 1)) };
                }
            }

            return { warning: ResolveWarningMessage.IncorrectDateTimeVariableFormat };
        });
    }

    private registerLocalDateTimeVariable() {
        this.resolveFuncs.set(Constants.LocalDateTimeVariableName, async name => {
            const groups = this.localDatetimeRegex.exec(name);
            if (groups !== null && groups.length === 4) {
                const [, type, offset, option] = groups;
                let date = dayjs.utc().local();
                if (offset && option) {
                    date = date.add(+offset, option as OpUnitType);
                }

                if (type === 'rfc1123') {
                    return { value: date.locale('en').format('ddd, DD MMM YYYY HH:mm:ss ZZ') };
                } else if (type === 'iso8601') {
                    return { value: date.format() };
                } else {
                    return { value: date.format(type.slice(1, type.length - 1)) };
                }
            }

            return { warning: ResolveWarningMessage.IncorrectLocalDateTimeVariableFormat };
        });
    }

    private registerGuidVariable() {
        this.resolveFuncs.set(Constants.GuidVariableName, async () => ({ value: uuidv4() }));
    }

    private registerRandomIntVariable() {
        this.resolveFuncs.set(Constants.RandomIntVariableName, async name => {
            const groups = this.randomIntegerRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const [, min, max] = groups;
                const minNum = Number(min);
                const maxNum = Number(max);
                if (minNum < maxNum) {
                    return { value: (Math.floor(Math.random() * (maxNum - minNum)) + minNum).toString() };
                }
            }

            return { warning: ResolveWarningMessage.IncorrectRandomIntegerVariableFormat };
        });
    }
    private registerProcessEnvVariable() {
        this.resolveFuncs.set(Constants.ProcessEnvVariableName, async name => {
            const groups = this.processEnvRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const [, refToggle, environmentVarName] = groups;
                let processEnvName = environmentVarName;
                if (refToggle !== undefined) {
                    processEnvName = await this.resolveSettingsEnvironmentVariable(environmentVarName);
                }
                const envValue = process.env[processEnvName];
                if (envValue !== undefined) {
                    return { value: envValue.toString() };
                } else {
                    return { value: '' };
                }
            }
            return { warning: ResolveWarningMessage.IncorrectProcessEnvVariableFormat };
        });
    }

    private registerDotenvVariable() {
        this.resolveFuncs.set(Constants.DotenvVariableName, async (name, document) => {
            let folderPath = path.dirname(document.fileName);
            while (!await fs.pathExists(path.join(folderPath, '.env'))) {
                folderPath = path.join(folderPath, '..');
                if (folderPath === path.parse(process.cwd()).root) {
                    return { warning: ResolveWarningMessage.DotenvFileNotFound };
                }
            }
            const absolutePath = path.join(folderPath, '.env');
            const groups = this.dotenvRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const parsed = dotenv.parse(await fs.readFile(absolutePath));
                const [, refToggle, key] = groups;
                let dotEnvVarName = key;
                if (refToggle !== undefined) {
                    dotEnvVarName = await this.resolveSettingsEnvironmentVariable(key);
                }
                if (!(dotEnvVarName in parsed)) {
                    return { warning: ResolveWarningMessage.DotenvVariableNotFound };
                }

                return { value: parsed[dotEnvVarName] };
            }

            return { warning: ResolveWarningMessage.IncorrectDotenvVariableFormat };
        });
    }

    private registerAadV2TokenVariable() {
        this.resolveFuncs.set(Constants.AzureActiveDirectoryV2TokenVariableName,
            async (name) => {
                const aadV2TokenProvider = new AadV2TokenProvider();
                const token = await aadV2TokenProvider.acquireToken(name);
                return { value: token };
            });
    }
    private async resolveSettingsEnvironmentVariable(name: string) {
        if (await this.innerSettingsEnvironmentVariableProvider.has(name)) {
            const { value, error, warning } = await this.innerSettingsEnvironmentVariableProvider.get(name);
            if (!error && !warning) {
                return value!.toString();
            } else {
                return name;
            }
        } else {
            return name;
        }
    }

    // #region AAD

    private getCloudProvider(endpoint: string): { cloud: string, targetApp: string } {
        for (const c in Constants.AzureClouds) {
            const { aad, arm, armAudience } = Constants.AzureClouds[c];
            if (aad === endpoint || arm === endpoint) {
                return {
                    cloud: c,
                    targetApp: arm === endpoint && armAudience ? armAudience : endpoint
                };
            }
        }

        // fall back to URL TLD
        return {
            cloud: endpoint.substr(endpoint.lastIndexOf('.') + 1),
            targetApp: endpoint
        };
    }

    // #endregion
}
