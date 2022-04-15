import { isEmpty, isNaN, reduce, find, includes, clone, omit } from 'lodash-es';

type Nullable<V> = V | null | undefined;
type DefaultScalars = Nullable<string | number | bigint | Date | unknown[]>;

interface FieldState<V = DefaultScalars> {
    field: string;
    label?: string;
    touched?: boolean;
    value: Nullable<V>;
    placeholder?: string;
    rejections: Array<string>;
}

interface Validate<V = unknown> {
    (value: Nullable<V>): Nullable<string | false | 0>;
}

interface FieldModelOptions<T> {
    initialValue?: T;
    required?: boolean;
    validateAllRules?: boolean;
}

export class FieldModel<T = DefaultScalars> {
    private readonly initialValue: T;
    private options: FieldModelOptions<T> = {};

    static from<T = DefaultScalars>(
        state: FieldState<T>,
        rules: Array<Validate<T>> = [],
        options: FieldModelOptions<T> = {},
    ) {
        return new FieldModel(state, rules, options);
    }

    constructor(
        public readonly state: FieldState<T>,
        public readonly rules: Array<Validate<T>> = [],
        options: FieldModelOptions<T> = {},
    ) {
        this.options = options;
        this.initialValue = clone(options.initialValue === undefined ? null : options.initialValue);
    }

    public validate(): Array<string> {
        this.state.touched = true;
        this.state.rejections = this.iterateRules();
        return this.state.rejections;
    }

    public get required(): boolean {
        return Boolean(this.options?.required);
    }

    public get value(): Nullable<T> {
        return this.state.value;
    }

    public set value(value: Nullable<T>) {
        this.state.value = value;

        if (!this.state.touched) {
            this.state.touched = true;
        }
    }

    private iterateRules(): Array<string> {
        const { value } = this.state;

        const result = [];

        for (const check of this.rules) {
            const rejection = check(value);

            if (!rejection) {
                continue;
            }

            result.push(rejection);

            if (!this.options.validateAllRules) {
                break;
            }
        }

        return result;
    }

    public reset(): void {
        this.value = clone(this.initialValue);
        this.state.touched = false;
    }
}

type FieldCollection<M> = {
    [P in (keyof M)]: M[P] extends Record<P, unknown>
        ? M[P] extends Array<unknown> ? FieldModel<M[P]> : FormModel<M[P]>
        : FieldModel<M[P]>;
}

type ValidationCollection<M> = {
    [P in (keyof M)]: string[];
}

interface ScalarFieldDef<M, P extends keyof M> {
    label?: string;
    required?: boolean;
    initialValue?: M[P];
    placeholder?: string;
    rules?: Array<Validate<M[P]>>;
}

type FieldsDef<M> = {
    [P in (keyof M)]: ScalarFieldDef<M, P> | { __complex: boolean } & FieldModel<M[P]>;
}

interface FormModelOptions {
    validateAllRules?: boolean;
}

export class FormModel<M> {
    public readonly fields: FieldCollection<M>;

    static from<M>(
        fields: FieldsDef<Partial<M>>,
        options?: FormModelOptions,
    ) {
        return new FormModel<M>(fields, options);
    }

    constructor(
        fields: FieldsDef<Partial<M>>,
        private options: FormModelOptions = { validateAllRules: false },
    ) {
        this.fields = reduce(
            fields,
            (result, def, field) => {
                const isScalar = !(def as { __complex: boolean })['__complex'];

                if (!isScalar) {
                    return {
                        ...result,
                        [field]: FormModel.from(omit(def, '__complex') as FieldsDef<unknown>, options),
                    };
                }

                const { placeholder, label, required, initialValue = null, rules = [] } = def as ScalarFieldDef<M, keyof M>;

                return {
                    ...result,
                    [field]: FieldModel.from(
                        { placeholder, field, label, rejections: [], touched: false, value: clone(initialValue), },
                        required ? rules.concat(nonNullable) : rules,
                        { required: Boolean(required), validateAllRules: options.validateAllRules },
                    ),
                };
            },
            {} as FieldCollection<M>,
        );
    }

    public get value(): M {
        return reduce(
            this.fields,
            (result, field, prop) => ({ ...result, [prop]: field.value }),
            {} as M,
        );
    }

    public set value(value: M) {
        for (const key in this.fields) {
            const { [key]: field } = this.fields;

            field.value = value[key];
        }
    }

    public get valid(): boolean {
        return !find(
            Object.keys(this.fields),
            (key: keyof M) => {
                const { [key]: field } = this.fields;

                if (field instanceof FormModel) {
                    return !field.valid;
                }

                return !field.state.touched || field.state.rejections.length;
            },
        );
    }

    public validate(): ValidationCollection<M> {
        return reduce(
            this.fields,
            (result, field, prop) => ({ ...result, [prop]: field.validate() }),
            {} as ValidationCollection<M>,
        );
    }

    public reset(): void {
        for (const field of Object.values(this.fields)) {
            (field as FieldModel<unknown>).reset();
        }
    }
}

const nonNullable: Validate = val => includes([null, undefined, ''], val) && '不能为空';
export const mustBeNumber: Validate = val => isNaN(Number(val)) && '必须为数字';
export const atLeastOne: Validate = val => isEmpty(val) && '至少选择一项';
