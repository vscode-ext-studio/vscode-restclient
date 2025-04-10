import * as os from 'os';
import * as path from 'path';

export class UserDataManager {

    public static getResponseSaveFilePath(fileName: string) {
        return path.join(os.homedir(), 'Downloads', fileName);
    }

    public static getResponseBodySaveFilePath(fileName: string) {
        return path.join(os.homedir(), 'Downloads', fileName);
    }
}
