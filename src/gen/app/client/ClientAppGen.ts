import {Question} from "inquirer";
import {Vesta} from "../../file/Vesta";
import {IProjectConfig} from "../../ProjectGen";
import {Util} from "../../../util/Util";
import {GitGen} from "../../file/GitGen";
import {FsUtil} from "../../../util/FsUtil";
import {Log} from "../../../util/Log";
import {GenConfig} from "../../../Config";

export interface IClientAppConfig {
    platform: string;
    isAdminPanel: boolean;
    type: string;
    framework: string;
}

export abstract class ClientAppGen {

    static Type = {Angular: 'angular', Angular2: 'angular2'};
    static Platform = {Browser: 'browser', Cordova: 'cordova'};
    static Framework = {Material: 'material', Ionic: 'ionic'};

    protected isCordova: boolean;
    protected vesta: Vesta;

    constructor(protected config: IProjectConfig) {
        this.isCordova = config.client.platform == ClientAppGen.Platform.Cordova;
        this.vesta = Vesta.getInstance(config);
    }

    private getRepoName(): string {
        let name = '',
            repo = GenConfig.repository;
        if (this.config.client.platform == ClientAppGen.Platform.Cordova) {
            name = repo.ionic;
        } else if (this.config.client.isAdminPanel) {
            name = repo.cpanel;
        } else {
            name = repo.material;
        }
        return name;
    }

    private cloneTemplate() {
        let dir = this.config.name,
            repo = GenConfig.repository;
        GitGen.clone(GitGen.getRepoUrl(repo.baseUrl, repo.group, this.getRepoName()), dir);
        GitGen.cleanClonedRepo(dir);
    }

    public generate() {
        this.cloneTemplate();
        let dir = this.config.name,
            templateProjectName = this.getRepoName(),
            replacePattern = {};
        replacePattern[templateProjectName] = dir;
        Util.findInFileAndReplace(`${dir}/src/app/config/setting.ts`, replacePattern);
        FsUtil.copy(`${dir}/resources/gitignore/src/app/config/setting.var.ts`, `${dir}/src/app/config/setting.var.ts`);
        if (this.isCordova) {
            FsUtil.mkdir(`${dir}/www`); // for installing plugins this folder must exist
            Util.findInFileAndReplace(dir + '/config.xml', replacePattern);
        }
    }

    public static getGeneratorConfig(): Promise<IClientAppConfig> {
        let config: IClientAppConfig = <IClientAppConfig>{};
        let qs: Array<Question> = [
            <Question>{
                type: 'list',
                name: 'platform',
                message: 'Platform: ',
                choices: [ClientAppGen.Platform.Browser, ClientAppGen.Platform.Cordova]
            }];
        Log.info(`For browser platform we use Material Design, and on Cordova we use Ionic (both on Angular 1.x)`);
        return new Promise((resolve) => {
            Util.prompt<{ platform: string }>(qs).then(answer => {
                config.type = ClientAppGen.Type.Angular;
                config.platform = answer.platform;
                if (config.platform == ClientAppGen.Platform.Browser) {
                    config.framework = ClientAppGen.Framework.Material;
                    return Util.prompt<{ isCPanel: boolean }>({
                        type: 'confirm',
                        name: 'isCPanel',
                        message: 'Is Admin Panel',
                        default: false
                    }).then(answer => {
                        config.isAdminPanel = answer.isCPanel;
                        resolve(config);
                    })
                } else {
                    config.framework = ClientAppGen.Framework.Ionic;
                }
                resolve(config);
            });
        });
    }
}
