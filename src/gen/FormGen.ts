import { Field, FieldType, IFieldProperties, RelationType } from "@vesta/core";
import { writeFileSync } from "fs-extra";
import { camelCase, upperFirst } from "lodash";
import { ArgParser } from "../util/ArgParser";
import { genRelativePath } from "../util/FsUtil";
import { Log } from "../util/Log";
import { getFieldForFormSelect, getFieldMeta, getFieldsByType, parseModel } from "../util/Model";
import { pascalCase, plural } from "../util/StringUtil";
import { IComponentGenConfig } from "./ComponentGen";
import { TsFileGen } from "./core/TSFileGen";
import { IFieldMeta } from "./FieldGen";
import { Vesta } from "./Vesta";

interface IFormFieldData {
    code: string;
    form: string;
    imports?: string[];
}

export interface IFormGenConfig extends IComponentGenConfig {
}

export class FormGen {

    public static help() {
        Log.write(`
Usage: vesta gen form <NAME> [options...]

Creating React component

    NAME        The name of the component

Options:
    --model     Create form based on this model [required]
    --path      Where to save component [default: src/client/component/root]
    --no-style  Do not generate scss style file

Example:
    vesta gen form test --model=User
`);
    }

    public static init() {
        const argParser = ArgParser.getInstance();
        const config: IFormGenConfig = {
            hasRoute: argParser.has("--with-route"),
            hasStyle: !argParser.has("--no-style"),
            independent: true,
            model: argParser.get("--model"),
            name: argParser.get(),
            path: argParser.get("--path", "root"),
        } as IFormGenConfig;
        if (!config.name) {
            Log.error("Missing/Invalid component name\nSee 'vesta gen form --help' for more information\n");
            return;
        }
        if (!config.model) {
            Log.error("Missaing/Invalid model\nSee 'vesta gen form --help' for more information\n");
            return;
        }
        (new FormGen(config)).generate();
    }

    constructor(private config: IFormGenConfig) {
        // const path = `${Vesta.directories.components}/${config.path}`;
        // mkdir(path);
    }

    public generate() {
        genForm(this.config);
    }
}

export function genForm(config: IFormGenConfig) {
    const model = parseModel(config.model);
    if (!model) { return; }
    const fileName = `${model.className}Form`;
    const writtenOnce: any = {};
    const schema = model.module.schema;
    const relationalFields = getFieldsByType(config.model, FieldType.Relation);
    // const appDir = Vesta.directories.app;
    // ts file
    const file = new TsFileGen(fileName);
    const method = file.addMethod(fileName);
    setImports();
    setContent();

    writeFileSync(`${config.path}/${fileName}.tsx`, file.generate(), { encoding: "utf8" });

    function setImports() {
        // imports
        const enumType = hasFieldOfType(FieldType.Enum) || hasFieldOfType(FieldType.Boolean) ? "IFormOption" : null;
        file.addImport(["React"], "react", true);
        file.addImport(["ComponentType", "useState"], "react");
        file.addImport(["Culture"], "@vesta/culture");
        file.addImport(["IValidationError", "IModelValidationMessage", "validationMessage"], "@vesta/core");
        file.addImport(["FormWrapper", enumType, "IComponentProps"], "@vesta/components");
        file.addImport([model.interfaceName, model.className], genRelativePath(config.path, model.file));
        // props
        const props = file.addInterface(`I${fileName}Props`);
        props.setParentClass(`IComponentProps`);
        props.addProperty({ name: "id", type: "number", isOptional: true });
        props.addProperty({ name: "goBack", type: `() => void` });
    }

    function setContent() {
        method.addParameter({ name: "props", type: `I${fileName}Props` });
        method.methodType = `ComponentType<I${fileName}Props>`;
        method.shouldExport = true;
        method.isArrow = true;

        method.appendContent(`
    const tr = Culture.getDictionary().translate;
    const service = Crud.getService<${model.interfaceName}>("${model.instanceName}");
    ${getAllEnums()}
    const formErrorsMessages = ${getValidationErrorMessages()}

    const [${model.instanceName}, set${model.className}] = useState<${model.interfaceName}>({});
    const [errors, setErrors] = useState<IValidationError>(null);
`);

        // state
        const extStates = [];
        if (relationalFields) {
            for (let fieldNames = Object.keys(relationalFields), i = 0, il = fieldNames.length; i < il; ++i) {
                const meta: IFieldMeta = getFieldMeta(config.model, fieldNames[i]);
                if (!meta.form || !meta.relation.showAllOptions) { continue; }
                const field = schema.getField(fieldNames[i]);
                const shouldBePlural = field.properties.relation.type !== RelationType.Many2Many;
                const pluralName = shouldBePlural ? plural(fieldNames[i]) : fieldNames[i];
                file.addImport([`I${meta.relation.model}`], genRelativePath(config.path, `${Vesta.directories.model}/${meta.relation.model}`));
                extStates.push(pluralName);
                method.appendContent(`const [${pluralName}, set${upperFirst(pluralName)}] = useState<I${meta.relation.model}>([]);`);
            }
        }

        // fetch [componentDidMount]
        // const fetchCodes = [];
        const fileFields = getFieldsByType(config.model, FieldType.File);
        const files = fileFields ? Object.keys(fileFields) : [];
        let finalCode = `set${model.className}({${model.instanceName}})`;
        const filesCode = [];
        for (let i = files.length; i--;) {
            filesCode.push(`if (${model.instanceName}.${files[i]}) {
                    ${model.instanceName}.${files[i]} = getFileUrl(\`${model.instanceName}/\${${model.instanceName}.${files[i]}}\`);
                }`);
        }
        if (filesCode.length) {
            file.addImport(["getFileUrl"], genRelativePath(config.path, `${Vesta.directories.app}/util/Util`));
            finalCode = `{
                ${filesCode.join("\n\t\t\t")}
                ${finalCode};
            }`;
        }
        method.appendContent(`useEffect(() => {
        const id = +props.id;
        if (isNaN(id)) { return; }
        service.fetch(id).then((${model.instanceName}) => ${finalCode});`);
        // render
        const formData = getFormData();
        const extStateCode = extStates.length ? `, ${extStates.join(", ")}` : "";
        const extraCode = formData.code ? `\n\t\t${formData.code}` : "";
        method.appendContent(`
    const errors = errors ? validationMessage(formErrorsMessages, errors) : {};${extraCode}

    return (
        <FormWrapper name="${model.instanceName}Form" onSubmit={onSubmit}>${formData.form}
            {props.children}
        </FormWrapper>
    );`);

        // onChange method
        method.appendContent(`function onChange(name: string, value: any){
        ${model.instanceName}[name] = value;
        setState({ ${model.instanceName} });
    }`);

        // // fetch method
        method.appendContent(`function onFetch(id: number){
        Preloader.show();
        return api.get<${model.interfaceName}>(\`${model.instanceName}/\${id}\`)
            .then((response) => {
                Preloader.hide();
                return response.items[0];
            })
            .catch((error) => {
                Preloader.hide();
                notif.error(error.message);
            });
    }`);
        // save method
        const resultCode = `setState({ showLoader: false });
                notif.success(tr("info_save_record"));
                onFetchAll(state.queryOption);
                props.history.goBack();`;
        let deleteCode = "";
        let uploadCode = "";
        let uploadResultCode = "";
        if (files.length) {
            deleteCode = `\n\t\tlet hasFile = false;
        const ${model.instanceName}Files: ${model.interfaceName} = {};`;
            for (let i = files.length; i--;) {
                const fieldName = files[0];
                deleteCode += `\n\t\tif (${model.instanceName}.${fieldName} && ${model.instanceName}.${fieldName} instanceof File) {
            ${model.instanceName}Files.${fieldName} = ${model.instanceName}.${fieldName};
            delete ${model.instanceName}.${fieldName};
            hasFile = true;
        }`;
            }
            uploadCode = `api.upload<${model.interfaceName}>(\`${model.instanceName}/file/\${response.items[0].id}\`, ${model.instanceName}Files) : response`;
            uploadResultCode = `\n\t\t\t.then((response) => {
                ${resultCode}
            })`;
        } else {
            uploadCode = `{
                ${resultCode}
            }`;
        }
        method.appendContent(`function onSubmit(){
        const ${model.instanceName}Model = new ${fileName}(model);
        const ${model.instanceName}Files: ${model.interfaceName} = {};

        const errors = ${model.instanceName}.validate();
        if (validationErrors) {
            return setState({validationErrors});
        }${deleteCode}
        setState({ showLoader: true, validationErrors: null });
        const data = ${model.instanceName}.getValues<${model.interfaceName}>();
        (model.id ? api.put<${model.interfaceName}>("${model.instanceName}", data) : api.post<${model.interfaceName}>("${model.instanceName}", data))
            .then((response) => ${uploadCode})${uploadResultCode}
            .catch((error) => {
                setState({ showLoader: false, validationErrors: error.violations });
                notif.error(error.message);
            });
    }`);

        // fetch functions for relations
        // if (relationalFields) {
        //     for (let fieldNames = Object.keys(relationalFields), i = 0, il = fieldNames.length; i < il; ++i) {
        //         const meta: IFieldMeta = getFieldMeta(config.model, fieldNames[i]);
        //         const field = schema.getField(fieldNames[i]);
        //         if (!meta.form || !meta.relation.showAllOptions) { continue; }
        //         const shouldBePlural = field.properties.relation.type !== RelationType.Many2Many;
        //         const methodPostfix = pascalCase(shouldBePlural ? plural(fieldNames[i]) : fieldNames[i]);
        //         const stateVar = shouldBePlural ? plural(fieldNames[i]) : fieldNames[i];
        //         const method = formClass.addMethod(`fetch${methodPostfix}`);
        //         if (meta.relation && meta.relation.model) {
        //             const modelName = meta.relation.model;
        //             const instanceName = camelCase(modelName);
        //             method.setAsArrowFunction(true);
        //             method.appendContent(`Preloader.show();
        //     ModelService.getService<I${modelName}>("${model.instanceName}").fetchAll()
        //         .then((${stateVar}) => {
        //             setState({ ${stateVar}});
        //             Preloader.hide();
        //         });`);
        //         }
        //     }
        // }
    }

    function getAllEnums() {
        const fields = schema.getFields();
        let code = "";
        for (let fieldsName = Object.keys(fields), i = 0, il = fieldsName.length; i < il; ++i) {
            const field = fields[fieldsName[i]];
            const fieldName = field.fieldName;
            if (field.properties.type === FieldType.Boolean) {
                const boolOptions = [`{ id: 0, title: tr("no") }`, `{ id: 1, title: tr("yes") }`];
                const boolOptionName = `booleanOptions`;

                if (!writtenOnce.boolean) {
                    writtenOnce.boolean = true;
                    code += `const ${boolOptionName}: IFormOption[] = [\n\t\t${boolOptions.join(",\n\t\t")},\n\t];`;
                }
            } else if (field.properties.type === FieldType.Enum) {

                // formFile.addImport([enumName], genRelativePath(config.path, `${appDir}/cmn/${modelMeta.enum.path}`));

                // const options = modelMeta.enum.options.map((option, index) => `{id: ${option}, title: tr("enum_${option.split(".")[1].toLowerCase()}")}`);
                // const optionName = `${fieldName}Options`;
                // code += `const ${optionName}: any[] = ;`;
                // formClass.addProperty({
                //     access: "private",
                //     defaultValue: `[\n\t\t${options.join(",\n\t\t")}]`,
                //     name: `${fieldName}Options`,
                //     type: "IFormOption[]",
                // });
            }
        }
        return code;
    }

    function getFieldData(field: Field): IFormFieldData {
        const fieldName = field.fieldName;
        if (fieldName === "id") { return null as IFormFieldData; }
        const fieldProps: IFieldProperties = field.properties;
        const modelMeta: IFieldMeta = getFieldMeta(config.model, fieldName);
        if (!modelMeta.form) { return null as IFormFieldData; }
        let form = "";
        let formCode = "";
        const imports = [];
        let component = "";
        let hasPlaceHolder = true;
        const properties = [`name="${fieldName}" label={tr("fld_${fieldName}")} value={${model.instanceName}.${fieldName}}`,
        `error={errors.${fieldName}} onChange={onChange}`];
        switch (fieldProps.type) {
            case FieldType.Text:
                hasPlaceHolder = !modelMeta.wysiwyg;
                component = modelMeta.wysiwyg ? "Wysiwyg" : "TextArea";
                break;
            case FieldType.String:
                component = "TextInput";
                break;
            case FieldType.Password:
                component = "TextInput";
                properties.push('type="password"');
                break;
            case FieldType.Tel:
                component = "TextInput";
                properties.push('type="tel"');
                break;
            case FieldType.EMail:
                component = "TextInput";
                properties.push('type="email"');
                break;
            case FieldType.URL:
                component = "TextInput";
                properties.push('type="url"');
                break;
            case FieldType.Number:
            case FieldType.Integer:
                component = "NumericInput";
                break;
            case FieldType.Float:
                component = "NumericInput";
                properties.push(`step={0.1}`);
                break;
            case FieldType.File:
                component = "FileInput";
                break;
            case FieldType.Timestamp:
                component = "DateTimeInput";
                break;
            case FieldType.Boolean:
                component = "Select";
                const boolOptions = [`{ id: 0, title: tr("no") }`, `{ id: 1, title: tr("yes") }`];
                const boolOptionName = `booleanOptions`;
                if (!writtenOnce.boolean) {
                    writtenOnce.boolean = true;
                    formCode += `const ${boolOptionName}: IFormOption[] = [\n\t\t\t${boolOptions.join(",\n\t\t\t")},\n\t\t];`;
                }
                properties.push(`options={${boolOptionName}}`);
                break;
            case FieldType.Enum:
                component = "Select";
                // const formClass = file.getClass();
                if (modelMeta.enum) {
                    const enumName = modelMeta.enum.options[0].split(".")[0];
                    if (modelMeta.enum.path) {
                        file.addImport([enumName], genRelativePath(config.path, `${Vesta.directories.cmn}/${modelMeta.enum.path}`));
                    } else {
                        file.addImport([enumName], genRelativePath(config.path, model.file));
                    }
                    const options = modelMeta.enum.options.map((option, index) => `{id: ${option}, title: tr("enum_${option.split(".")[1].toLowerCase()}")}`);
                    const optionName = `${fieldName}Options`;
                    // code += `const ${optionName}: any[] = ;`;
                    // formClass.addProperty({
                    //     access: "private",
                    //     defaultValue: `[\n\t\t${options.join(",\n\t\t")}]`,
                    //     name: `${fieldName}Options`,
                    //     type: "IFormOption[]",
                    // });
                    properties.push(`options={${optionName}}`);
                }
                break;
            case FieldType.Relation:
                if (!modelMeta.relation) { break; }
                const relModelName = modelMeta.relation.model;
                const searchableField = getFieldForFormSelect(relModelName);
                const relInstanceName = camelCase(relModelName);
                const isMulti = fieldProps.relation.type === RelationType.Many2Many;
                properties.push(`titleKey="${searchableField}"`);
                const pluralName = isMulti ? fieldName : plural(fieldName);
                if (modelMeta.relation.showAllOptions) {
                    component = isMulti ? "Multichoice" : "Select";
                    properties.push(`options={${pluralName}}`);
                } else {
                    // import relational model
                    file.addImport([`I${relModelName}`],
                        genRelativePath(config.path, `${Vesta.directories.model}/${relModelName}`));
                    const methodName = `search${pascalCase(pluralName)}`;
                    //         const method = file.getClass().addMethod(methodName, ClassGen.Access.Private);
                    //         method.setAsArrowFunction();
                    //         method.addParameter({ name: "term", type: "string" });
                    //         method.setContent(`return api.get<I${relModelName}>("${relInstanceName}", {query: {${searchableField}: \`*\${term}*\`}, limit: 10, fields: ["id", "${searchableField}"]})
                    // .then((response) => response.items);`);
                    //         component = "Autocomplete";
                    //         properties.push(`search={${methodName}}`);
                    //         if (isMulti) {
                    //             properties.push(`multi={true}`);
                    //         }
                }
                break;
            case FieldType.List:
                break;
            case FieldType.Object:
                Log.warning(`Unsupported field type for ${fieldName}`);
                break;
            default:
                Log.error(`Unknown field type for ${fieldName} of type ${fieldProps.type}`);
        }
        if (component) {
            if (hasPlaceHolder) {
                properties.splice(1, 0, "placeholder={true}");
            }
            imports.push(component);
            form = `\n\t\t\t\t<${component} ${properties[0]} \n\t\t\t\t\t`;
            properties.shift();
            form += `${properties.join(" ")} />`;
        }
        return { imports, form, code: formCode };
    }

    function getFieldErrorMessages(field: Field) {
        if (field.fieldName === "id") { return null; }
        const meta: IFieldMeta = getFieldMeta(config.model, field.fieldName);
        if (!meta.form) { return; }
        const messages: any = {};
        const fieldProps: IFieldProperties = field.properties;
        if (fieldProps.required) {
            messages.required = 'tr("err_required")';
        }
        if (fieldProps.min) {
            messages.min = `tr("err_min_value", ${field.properties.min})`;
        }
        if (fieldProps.max) {
            messages.max = `tr("err_max_value", ${field.properties.max})`;
        }
        if (fieldProps.minLength) {
            messages.minLength = `tr("err_min_length", ${field.properties.minLength})`;
        }
        if (fieldProps.maxLength) {
            messages.maxLength = `tr("err_max_length", ${field.properties.maxLength})`;
        }
        if (fieldProps.maxSize) {
            messages.maxSize = `tr("err_file_size", ${field.properties.maxSize})`;
        }
        if (fieldProps.fileType.length) {
            messages.fileType = `tr("err_file_type")`;
        }
        if (fieldProps.enum.length) {
            messages.enum = `tr("err_enum")`;
        }
        switch (fieldProps.type) {
            case FieldType.Text:
                break;
            case FieldType.String:
                break;
            case FieldType.Password:
                break;
            case FieldType.Tel:
                messages.type = `tr("err_phone")`;
                break;
            case FieldType.EMail:
                messages.email = `tr("err_email")`;
                break;
            case FieldType.URL:
                messages.type = `tr("err_url")`;
                break;
            case FieldType.Integer:
            case FieldType.Number:
            case FieldType.Float:
                messages.type = `tr("err_number")`;
                break;
            case FieldType.File:
                break;
            case FieldType.Timestamp:
                messages.type = `tr("err_date")`;
                break;
            case FieldType.Boolean:
                messages.type = `tr("err_enum")`;
                break;
            case FieldType.Enum:
                messages.type = `tr("err_enum")`;
                break;
            case FieldType.Relation:
                messages.type = `tr("err_relation")`;
                break;
            case FieldType.List:
                break;
            case FieldType.Object:
                break;
        }
        return Object.keys(messages).length ? messages : null;
    }

    function getFormData(): IFormFieldData {
        const fields = schema.getFields();
        let formComponents = "";
        let formComponentsToImport = [];
        const codes = [];
        for (let fieldsName = Object.keys(fields), i = 0, il = fieldsName.length; i < il; ++i) {
            const fieldData = getFieldData(fields[fieldsName[i]]);
            if (!fieldData) { continue; }
            formComponentsToImport = formComponentsToImport.concat(fieldData.imports);
            formComponents += fieldData.form;
            if (fieldData.code) {
                codes.push(fieldData.code);
            }
        }
        const importedComponents = [];
        formComponentsToImport.forEach((component) => {
            if (importedComponents.indexOf(component) >= 0) { return; }
            file.addImport([component], "@vesta/components");
        });
        return { form: formComponents, code: codes.join("\n\t\t") };
    }

    function getValidationErrorMessages() {
        const fields = schema.getFields();
        const codes = [];
        for (let fieldsName = Object.keys(fields).sort(), i = 0, il = fieldsName.length; i < il; ++i) {
            const messages = getFieldErrorMessages(fields[fieldsName[i]]);
            if (!messages) { continue; }
            const partialCodes: string[] = [];
            for (let rules = Object.keys(messages).sort(), j = 0, jl = rules.length; j < jl; ++j) {
                partialCodes.push(`${rules[j]}: ${messages[rules[j]]}`);
            }
            codes.push(`\n\t\t\t${fieldsName[i]}: {\n\t\t\t\t${partialCodes.join(",\n\t\t\t\t")},\n\t\t\t}`);
        }
        return codes.length ? `{${codes.join(",")},\n\t\t};` : "";
    }

    function hasFieldOfType(type: FieldType) {
        const fields = schema.getFields();
        for (let fieldsName = Object.keys(fields), i = 0, il = fieldsName.length; i < il; ++i) {
            if (fields[fieldsName[i]].properties.type === type) { return true; }
        }
        return false;
    }
}
