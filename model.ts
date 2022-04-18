import { isEmpty, isNaN, reduce, find, includes, clone, omit } from 'lodash-es';

type Nullable<V> = V | null | undefined;
type DefaultScalars = Nullable<string | number | bigint | Date | unknown[]>;

interface ScalarModelState<V = DefaultScalars> {
    prop: string;
    label?: string;
    touched?: boolean;
    value: Nullable<V>;
    placeholder?: string;
    rejections: Array<string>;
}

interface Validate<V = unknown> {
    (value: Nullable<V>): Nullable<string | false | 0>;
}

interface ScalarModelOptions<T> {
    initialValue?: T;
    required?: boolean;
    validateAllRules?: boolean;
}

interface ValueModel<T = unknown, R = unknown> {
    reset(): void;
    validate(): R;

    set value(v: T);
    get value(): Nullable<T>;
    get valid(): boolean;
}

export class ScalarModel<T = DefaultScalars> implements ValueModel<T, Array<string>> {
    private readonly initialValue: T;
    private options: ScalarModelOptions<T> = {};

    static from<T = DefaultScalars>(
        state: ScalarModelState<T>,
        rules: Array<Validate<T>> = [],
        options: ScalarModelOptions<T> = {},
    ) {
        return new ScalarModel(state, rules, options);
    }

    constructor(
        private readonly state: ScalarModelState<T>,
        public readonly rules: Array<Validate<T>> = [],
        options: ScalarModelOptions<T> = {},
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

    public get valid(): boolean {
        const { touched, rejections } = this.state;
        return !touched || Boolean(rejections.length);
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
                return result;
            }
        }
    }

    public reset(): void {
        this.value = clone(this.initialValue);
        this.state.touched = false;
    }
}

type MemberCollection<M> = {
    [P in (keyof M)]: ValueModel<
        M[P],
        M[P] extends Record<P, unknown> ? ValidationCollection<M[P]> : Array<string>
    >
}

type ValidationCollection<M> = {
    [P in (keyof M)]: string[];
}

interface ScalarMemberDef<M, P extends keyof M> {
    label?: string;
    required?: boolean;
    initialValue?: M[P];
    placeholder?: string;
    rules?: Array<Validate<M[P]>>;
}

type MembersDef<M> = {
    [P in (keyof M)]: ScalarMemberDef<M, P> | { __complex: boolean } & ScalarModel<M[P]>;
}

interface ComplexModelOptions {
    validateAllRules?: boolean;
}

export class ComplexModel<M> implements ValueModel<M, ValidationCollection<M>>{
    public readonly members: MemberCollection<M>;

    static from<M>(
        members: MembersDef<Partial<M>>,
        options?: ComplexModelOptions,
    ) {
        return new ComplexModel<M>(members, options);
    }

    constructor(
        members: MembersDef<Partial<M>>,
        private options: ComplexModelOptions = { validateAllRules: false },
    ) {
        this.members = reduce(
            members,
            (result, def, prop) => {
                const isScalar = !(def as { __complex: boolean })['__complex'];

                if (!isScalar) {
                    return {
                        ...result,
                        [prop]: ComplexModel.from(omit(def, '__complex') as MembersDef<unknown>, options),
                    };
                }

                const { placeholder, label, required, initialValue = null, rules = [] } = def as ScalarMemberDef<M, keyof M>;

                return {
                    ...result,
                    [prop]: ScalarModel.from(
                        { placeholder, prop, label, rejections: [], touched: false, value: clone(initialValue), },
                        required ? rules.concat(nonNullable) : rules,
                        { required: Boolean(required), validateAllRules: options.validateAllRules },
                    ),
                };
            },
            {} as MemberCollection<M>,
        );
    }

    public get value(): M {
        return reduce(
            this.members,
            (result, member, prop) => ({ ...result, [prop]: member.value }),
            {} as M,
        );
    }

    public set value(value: M) {
        for (const key in this.members) {
            const { [key]: member } = this.members;

            member.value = value[key];
        }
    }

    public get valid(): boolean {
        return !find(
            Object.keys(this.members),
            (key: keyof M) => {
                const { [key]: member } = this.members;
                return !member.valid;
            },
        );
    }

    public validate(): ValidationCollection<M> {
        return reduce(
            this.members,
            (result, member, prop) => ({ ...result, [prop]: member.validate() }),
            {} as ValidationCollection<M>,
        );
    }

    public reset(): void {
        for (const member of Object.values<ValueModel>(this.members)) {
            member.reset();
        }
    }
}

const nonNullable: Validate = val => includes([null, undefined, ''], val) && '不能为空';
export const mustBeNumber: Validate = val => isNaN(Number(val)) && '必须为数字';
export const atLeastOne: Validate = val => isEmpty(val) && '至少选择一项';
