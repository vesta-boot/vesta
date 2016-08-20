import {Question} from "inquirer";
import {DockerUtil} from "../util/DockerUtil";
import {Util} from "../util/Util";

export class Init {

    static initProject() {
        Util.prompt<{initType: string}>(<Question>{
            name: 'initType',
            message: 'Choose one of the following operations',
            type: 'list',
            choices: ['Install Docker', 'Install DockerCompose']
        })
            .then(answer=> {
                switch (answer.initType) {
                    case 'Install Docker':
                        DockerUtil.installEngine();
                        break;
                    case 'Install DockerCompose':
                        DockerUtil.installCompose();
                        break;
                }
            })
    }

    static parse(args: Array<string>) {
        if (!args.length || ['-h', '--help', 'help'].indexOf(args[0]) >= 0) {
            return Init.help();
        }
        if (args.indexOf('--docker-compose') >= 0) return DockerUtil.installCompose();
        if (args.indexOf('--docker') >= 0) return DockerUtil.installEngine();
        Init.initProject();
    }

    static help() {
        process.stdout.write(`
Usage: vesta init [options...]

Creating new project after asking a series of questions through interactive shell

Options:
    --docker            Installs the docker engine
    --docker-compose    Installs the docker compose
    -h,--help           Display this help
`);
    }
}