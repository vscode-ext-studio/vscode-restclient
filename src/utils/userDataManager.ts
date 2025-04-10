import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { HistoricalHttpRequest } from '../models/httpRequest';
import { JsonFileUtility } from './jsonFileUtility';

const restClientDir = 'rest-client';
const rootPath = path.join(os.homedir(), `.${restClientDir}`);

function getCachePath(): string {
    if (fs.existsSync(rootPath)) {
        return rootPath;
    }

    if (process.env.XDG_CACHE_HOME !== undefined) {
        return path.join(process.env.XDG_CACHE_HOME, restClientDir);
    }

    return rootPath;
}

function getConfigPath(): string {
    if (fs.existsSync(rootPath)) {
        return rootPath;
    }

    if (process.env.XDG_CONFIG_HOME !== undefined) {
        return path.join(process.env.XDG_CONFIG_HOME, restClientDir);
    }

    return rootPath;
}

export class UserDataManager {

    public static getResponseSaveFilePath(fileName: string) {
        return path.join(os.homedir(), 'Downloads', fileName);
    }

    public static getResponseBodySaveFilePath(fileName: string) {
        return path.join(os.homedir(), 'Downloads', fileName);
    }
}
