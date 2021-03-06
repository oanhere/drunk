/// <reference path="../viewmodel/viewmodel.ts" />
/// <reference path="../template/loader.ts" />
/// <reference path="../template/compiler.ts" />
/// <reference path="../config/config.ts" />
/// <reference path="../util/dom.ts" />
/// <reference path="../util/util.ts" />


namespace drunk {

    import dom = drunk.dom;
    import util = drunk.util;
    import config = drunk.config;
    import Promise = drunk.Promise;
    import Template = drunk.Template;
    import ViewModel = drunk.ViewModel;

    let weakRefKey = 'DRUNK-COMPONENT-ID';
    let record: { [name: string]: boolean } = {};

    export interface IComponentOptions {
        name?: string;
        init?(): any;
        release?(): any;
        data?: { [name: string]: any };
        filters?: { [name: string]: Filter.IFilter };
        watchers?: { [expression: string]: IBindingAction };
        handlers?: { [name: string]: Function };
        element?: Node | Node[];
        template?: string;
        templateUrl?: string;
    }

    export interface IComponentContructor<T extends IComponentOptions> {
        extend?<T extends IComponentOptions>(name: string | T, members?: T): IComponentContructor<T>;
        (...args: any[]): void;
    }

    /**
     * Decorator for Component.register
     */
    export function component(name: string) {
        return function (constructor: any) {
            Component.register(name, constructor);
        };
    }

    export class Component extends ViewModel {

        /**
         * 组件是否已经挂在到元素上
         */
        protected _isMounted: boolean;

        /**
         * 组件被定义的名字
         */
        name: string;

        /** 作为模板并与数据进行绑定的元素,可以创建一个组件类是指定该属性用于与视图进行绑定 */
        element: Node | Node[];

        /** 组件的模板字符串,如果提供该属性,在未提供element属性的情况下会创建为模板元素 */
        template: string;

        /**
         * 组件的模板路径,可以是页面上某个标签的id,默认先尝试当成标签的id进行查找,找到的话使用该标签的innerHTML作为模板字符串,
         * 未找到则作为一个服务端的链接发送ajax请求获取
         */
        templateUrl: string;

        /**
         * 组件类，继承ViewModel类，实现了模板的准备和数据的绑定
         * @param  model  初始化的数据
         */
        constructor(model?: IModel) {
            super(model);
            Component.instancesById[util.uniqueId(this)] = this;
        }

        /**
         * 实例创建时会调用的初始化方法,派生类可覆盖该方法
         */
        init() {

        }

        /**
         * 实例销毁时调用的方法，派生类可覆盖该方法
         */
        release() {

        }

        /**
         * 属性初始化
         * @param  model 数据
         */
        protected __init(model?: IModel) {
            super.__init(model);

            Object.defineProperties(this, {
                _isMounted: {
                    value: false,
                    writable: true,
                    configurable: true
                }
            });

            this.init();
        }

        /**
         * 设置数据过滤器
         */
        $setFilters(filters: { [name: string]: Filter.IFilter }) {
            if (this.$filter) {
                util.extend(this.$filter, filters);
            } else {
                console.warn(`Component#$setFilters： 组件未初始化`);
            }
        }

        /**
         * 设置初始化数据
         */
        $resolveData(dataDescriptors: { [name: string]: any }) {
            if (!dataDescriptors) {
                return Promise.resolve();
            }
            return Promise.all(Object.keys(dataDescriptors).map(property => {
                // 代理该数据字段
                this.$proxy(property);

                let value = dataDescriptors[property];
                if (typeof value === 'function') {
                    // 如果是一个函数,直接调用该函数
                    value = value.call(this);
                }

                return Promise.resolve(value).then(
                    result => this[property] = result,
                    reason => console.warn(`Component数据["${property}"]初始化失败:`, reason)
                );
            }));
        }

        /**
         * 处理模板，并返回模板元素
         */
        $processTemplate(templateUrl?: string): Promise<any> {
            let onFailed = (reason) => {
                this.$emit(Component.Event.templateLoadFailed, this);
                console.warn(`模板加载失败: ${templateUrl}`, reason);
            }

            if (typeof templateUrl === 'string') {
                return Template.renderFragment(templateUrl, null, true).then(fragment => util.toArray(fragment.childNodes)).catch(onFailed);
            }
            if (this.element) {
                return Promise.resolve(this.element);
            }
            if (typeof this.template === 'string') {
                return Promise.resolve(dom.create(this.template));
            }

            templateUrl = this.templateUrl;
            if (typeof templateUrl === 'string') {
                return Template.renderFragment(templateUrl, null, true).then(fragment => util.toArray(fragment.childNodes)).catch(onFailed);
            }

            throw new Error(`${(this.name || (<any>this.constructor).name)}组件的模板未指定`);
        }

        /**
         * 把组件挂载到元素上
         * @param  element         要挂在的节点或节点数组
         * @param  ownerViewModel  父级viewModel实例
         * @param  placeholder     组件占位标签
         */
        $mount<T extends Component>(element: Node | Node[], ownerViewModel?: T, placeholder?: HTMLElement) {
            console.assert(!this._isMounted, `重复挂载,该组件已挂载到:`, this.element);

            if (Component.getByElement(element)) {
                return console.error(`$mount(element): 尝试挂载到一个已经挂载过组件实例的元素节点`, element);
            }

            Template.compile(element)(this, element, ownerViewModel, placeholder);

            this.element = element;
            this._isMounted = true;

            let nodeList: Node[] = Array.isArray(element) ? <Node[]>element : [element];
            nodeList.forEach(node => Component.setWeakRef(node, this));

            this.$emit(Component.Event.mounted);
        }

        /**
         * 释放组件
         */
        $release() {
            if (!this._isActived) {
                return;
            }

            this.release();
            this.$emit(Component.Event.release, this);

            super.$release();

            if (this._isMounted) {
                this._isMounted = false;

                let nodeList: Node[] = Array.isArray(this.element) ? <Node[]>this.element : [<Node>this.element];
                nodeList.forEach(node => Component.removeWeakRef(node));
                dom.remove(this.element);
            }

            Component.instancesById[util.uniqueId(this)] = this.element = null;
        }

        /**
         * 组件构造函数
         */
        static constructorsByName: { [name: string]: IComponentContructor<any> } = {};

        /**
         * 组件为加载的资源
         */
        static resourcesByName: { [name: string]: string } = {};

        /** 组件实例 */
        static instancesById: { [id: number]: Component } = {};

        /**
         * 组件的事件名称
         */
        static Event = {
            created: 'created',
            release: 'release',
            mounted: 'mounted',
            templateLoadFailed: 'templateLoadFailed',
        }

        /**
         * 获取挂在在元素上的viewModel实例
         * @param   element 元素
         * @return  Component实例
         */
        static getByElement(element: any) {
            return element && Component.instancesById[element[weakRefKey]];
        }

        /**
         * 设置element与viewModel的引用
         * @param   element    元素
         * @param   component  组件实例
         */
        static setWeakRef<T extends Component>(element: any, component: T) {
            element[weakRefKey] = util.uniqueId(component);
        }

        /**
         * 移除挂载引用
         * @param  element  元素
         */
        static removeWeakRef(element: any) {
            delete element[weakRefKey];
        }

        /**
         * 根据组件名字获取组件构造函数
         * @param  name  组件名
         * @return  组件类的构造函数
         */
        static getConstructorByName(name: string): IComponentContructor<any> {
            return Component.constructorsByName[name];
        }

        /**
         * 根据组件名获取组件的资源链接
         */
        static getResourceByName(name: string): string {
            return Component.resourcesByName[name];
        }

        /**
         * 自定义一个组件类
         * @param  name     组件名，必然包含'-'在中间
         * @param  members  组件成员
         * @return          组件类的构造函数
         */
        static define<T extends IComponentOptions>(options: T): IComponentContructor<T>;
        static define<T extends IComponentOptions>(name: string, options: T): IComponentContructor<T>;
        static define<T extends IComponentOptions>(...args: any[]) {
            let options: T;
            if (args.length === 2) {
                options = args[1];
                options.name = args[0];
            }
            else {
                options = args[0];
            }
            return Component.extend(options);
        }

        /**
         * 当前组件类拓展出一个子组件
         * @param    name       子组件名
         * @param    members    子组件的实现配置项
         * @return              组件类的构造函数
         */
        static extend<T extends IComponentOptions>(options: T): IComponentContructor<T>;
        static extend<T extends IComponentOptions>(name: string, options: T): IComponentContructor<T>;
        static extend<T extends IComponentOptions>(name: string | T, options?: T) {
            if (arguments.length === 1 && Object.prototype.toString.call(name) === '[object Object]') {
                options = arguments[0];
                name = options.name;
            }

            var superClass = this;
            var prototype = Object.create(superClass.prototype);
            var watchers: Object;
            var handlers: Object;
            var filters: Object;
            var computeds: Object;
            var data: Object;

            Object.keys(options).forEach(key => {
                if (key === "watchers") {
                    watchers = options[key];
                } else if (key === "filters") {
                    filters = options[key];
                } else if (key === 'computeds') {
                    computeds = options[key];
                } else if (key === 'data') {
                    data = options[key];
                } else if (key === 'handlers') {
                    handlers = options[key];
                } else {
                    prototype[key] = options[key];
                }
            });

            var component: IComponentContructor<T> = function (...args: any[]) {
                superClass.apply(this, args);

                if (filters) {
                    this.$setFilters(filters);
                }
                if (handlers) {
                    util.extend(this, handlers);
                }
                if (computeds) {
                    Object.keys(computeds).forEach(property => this.$computed(property, computeds[property]));
                }
                if (watchers) {
                    Object.keys(watchers).forEach(expression => this.$watch(expression, watchers[expression]));
                }
                if (data) {
                    this.$resolveData(data);
                }
            };

            component.prototype = prototype;
            prototype.constructor = component;

            if (name) {
                Component.register((<string>name), component);
            }
            else {
                component.extend = Component.extend;
            }

            return component;
        }

        /**
         * 把一个继承了drunk.Component的组件类根据组件名字注册到组件系统中
         * @param  name          组件名
         * @param  componentCtor 组件类
         */
        static register(name: string, componentCtor: any) {
            console.assert(name.indexOf('-') > -1, `非法组件名"${name}", 组件名必须在中间带"-"字符,如"custom-view"`);

            if (Component.constructorsByName[name] != null) {
                console.warn(`组件"${name}"定义已被覆盖,请确认该操作`);
            }

            componentCtor.extend = Component.extend;
            Component.constructorsByName[name] = componentCtor;

            addHiddenStyleForComponent(name);
        }

        /**
         * 注册组件资源，资源只会在需要构造组件时才会加载
         */
        static registerByResourcesLazy(components: { [name: string]: string }) {
            Object.keys(components).forEach(name => {
                if (this.resourcesByName[name] != null) {
                    console.warn(`组件"${name}"资源变化: ${this.resourcesByName[name]} => ${components[name]}`);
                }
                this.resourcesByName[name] = components[name];
                this.constructorsByName[name] = null;
                addHiddenStyleForComponent(name);
            });
        }

        /**
         * 注册并加载组件资源
         */
        static registerByResources(components: { [name: string]: string }) {
            this.registerByResourcesLazy(components);
            Object.keys(components).forEach(name => {
                Template.renderFragment(components[name], null, true);
            });
        }
    }

    /**
     * 设置样式
     */
    function addHiddenStyleForComponent(name: string) {
        if (record[name]) {
            return;
        }

        dom.addCSSRule({ [name]: { display: 'none' } });
        record[name] = true;
    }

    Component.register(config.prefix + 'view', Component);
}