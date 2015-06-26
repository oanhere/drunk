/// <reference path="../viewmodel/viewmodel" />
/// <reference path="../template/loader" />
/// <reference path="../config/config" />

module drunk {

    export interface IComponent {
        name?: string;
        init?: () => void;
        data?: { [name: string]: any };
        filters?: { [name: string]: filter.IFilter };
        watchers?: { [expression: string]: IBindingUpdateAction };
        handlers?: { [name: string]: Function };
        element?: Node | Node[];
        template?: string;
        templateUrl?: string;
    }

    export interface IComponentContructor<T extends IComponent> {
        extend?<T extends IComponent>(name: string | T, members?: T): IComponentContructor<T>;
        (...args: any[]): void;
    }

    export interface IComponentEvent {
        created: string;
        dispose: string;
        mounted: string;
    }

    export class Component extends ViewModel {
        
        /**
         * 组件是否已经挂在到元素上
         * @property _isMounted
         * @private
         * @type boolean
         */
        private _isMounted: boolean;
        
        /**
         * 组件被定义的名字
         * @property name
         * @type string
         */
        name: string;
        
        /**
         * 作为模板并与数据进行绑定的元素,可以创建一个组件类是指定该属性用于与视图进行绑定
         * @property element
         * @type HTMLElement
         */
        element: Node | Node[];
        
        /**
         * 组件的模板字符串,如果提供该属性,在未提供element属性的情况下会创建为模板元素
         * @property template
         * @type string
         */
        template: string;
        
        /**
         * 组件的模板路径,可以是页面上某个标签的id,默认先尝试当成标签的id进行查找,找到的话使用该标签的innerHTML作为模板字符串,
         * 未找到则作为一个服务端的链接发送ajax请求获取
         * @property templateUrl
         * @type string
         */
        templateUrl: string;
        
        /**
         * 组件的数据,会被初始化到Model中,可以为一个函数,函数可以直接返回值或一个处理值的Promise对象
         * @property data
         * @type {[name: string]: any}
         */
        data: { [name: string]: any };
        
        /**
         * 该组件作用域下的数据过滤器表
         * @property filters
         * @type {[name]: Filter}
         */
        filters: { [name: string]: filter.IFilter };
        
        /**
         * 该组件作用域下的事件处理方法
         * @property handlers
         * @type {[name]: Function}
         */
        handlers: { [name: string]: (...args) => void };
        
        /**
         * 监控器描述,key表示表达式,值为监控回调
         * @property watchers
         * @type object
         */
        watchers: { [expression: string]: (newValue: any, oldValue: any) => void };
        
        /**
         * 组件类，继承ViewModel类，实现了模板的准备和数据的绑定
         * @class Component
         * @constructor
         */
        constructor(model?: IModel) {
            super(model);
        }
        
        /**
         * 实例创建时会调用的初始化方法,派生类可覆盖该方法
         * @method init
         */
        init() {
            
        }

        /**
         * 属性初始化
         * @method __init
         * @override
         * @protected
         * @param  {IModel}  [model]  model对象
         */
        protected __init(model?: IModel) {
            super.__init.call(this, model);

            if (this.filters) {
                // 如果配置了过滤器
                util.extend(this.filter, this.filters);
            }
            if (this.handlers) {
                // 如果配置了事件处理函数
                util.extend(this, this.handlers);
            }

            if (this.data) {
                Object.keys(this.data).forEach(name => {
                    var data = this.data[name];

                    if (typeof data === 'function') {
                        // 如果是一个函数,直接调用该函数
                        data = data.call(this);
                    }
                
                    // 代理该数据字段
                    this.proxy(name);
                
                    // 不论返回的是什么值,使用promise进行处理
                    Promise.resolve(data).then(
                        result => {
                            this[name] = result;
                        },
                        reason => {
                            console.warn("数据准备失败:", reason);
                        });
                });
            }
            
            this.init();
            
            if (this.watchers) {
                // 如果配置了监控器
                Object.keys(this.watchers).forEach((expression) => {
                    this.watch(expression, this.watchers[expression]);
                });
            }
        }
        
        /**
         * 处理模板，并返回模板元素
         * @method processTemplate
         * @return {Promise}
         */
        processTemplate(templateUrl?: string): Promise<any> {
            function onFailed(reason) {
                console.warn("模板加载失败: " + templateUrl, reason);
            }

            if (typeof templateUrl === 'string') {
                return Template.load(templateUrl).then(elementUtil.create).catch(onFailed);
            }

            if (this.element) {
                return Promise.resolve(this.element);
            }

            if (typeof this.template === 'string') {
                return Promise.resolve(elementUtil.create(this.template));
            }

            templateUrl = this.templateUrl;
            
            if (typeof templateUrl === 'string') {
                return Template.load(templateUrl).then(elementUtil.create).catch(onFailed);
            }

            throw new Error((this.name || (<any>this.constructor).name) + "组件模板未指定");
        }
        
        /**
         * 把组件挂载到元素上
         * @method mount
         * @param {Node|Node[]} element         要挂在的节点或节点数组
         * @param {Component}   ownerViewModel  父级viewModel实例
         * @param {HTMLElement} placeholder     组件占位标签
         */
        mount<T extends Component>(element: Node | Node[], ownerViewModel?: T, placeholder?: HTMLElement) {
            console.assert(!this._isMounted, "该组件已有挂载到", this.element);

            if (Component.getByElement(element)) {
                return console.error("Component#mount(element): 尝试挂载到一个已经挂载过组件实例的元素节点", element);
            }

            Template.compile(element)(this, element, ownerViewModel, placeholder);

            Component.setWeakRef(element, this);

            this.element = element;
            this._isMounted = true;
        }
        
        /**
         * 释放组件
         * @method dispose
         */
        dispose() {
            this.emit(Component.Event.dispose);

            super.dispose();

            if (this._isMounted) {
                Component.removeWeakRef(this.element);
                this._isMounted = false;
            }
            this.element = null;
        }
    }

    export module Component {

        let weakRefMap: { [id: number]: Component } = {};
        
        /**
         * 组件的事件名称
         * @property Event
         * @static
         * @type  IComponentEvent
         */
        export let Event: IComponentEvent = {
            created: 'created',
            dispose: 'release',
            mounted: 'mounted'
        }
        
        /**
         * 获取挂在在元素上的viewModel实例
         * @method getByElement
         * @static
         * @param  {any}  element 元素
         * @return {Component}    viewModel实例
         */
        export function getByElement(element: any) {
            let uid = util.uuid(element);

            return weakRefMap[uid];
        }
        
        /**
         * 设置element与viewModel的引用
         * @method setWeakRef
         * @static
         * @param  {any}        element    元素
         * @param  {Component}  viewModel  组件实例
         */
        export function setWeakRef<T extends Component>(element: any, viewModel: T) {
            let uid = util.uuid(element);

            if (weakRefMap[uid] !== undefined && weakRefMap[uid] !== viewModel) {
                console.error(element, '元素尝试挂载到不同的组件实例');
            }
            else {
                weakRefMap[uid] = viewModel;
            }
        }
        
        /**
         * 移除挂载引用
         * @method removeMountedRef
         * @param  {any}  element  元素
         */
        export function removeWeakRef(element: any) {
            let uid = util.uuid(element);

            if (weakRefMap[uid]) {
                delete weakRefMap[uid];
            }
        }

        /**
         * 定义的组件记录
         * @property definedComponent
         * @private
         * @type {object}
         */
        let definedComponentMap: { [name: string]: IComponentContructor<any> } = {};
        
        
        /**
         * 根据组件名字获取组件构造函数
         * @method getComponentByName
         * @param  {string}  name  组件名
         * @return {IComponentConstructor}
         */
        export function getComponentByName(name: string): IComponentContructor<any> {
            return definedComponentMap[name];
        }
        
        /**
         * 自定义一个组件类
         * @method define
         * @static
         * @param  {string}
         */
        export function define<T extends IComponent>(name: string, members: T) {
            members.name = name;
            return Component.extend(members);
        }
        
        /**
         * 当前组件类拓展出一个子组件
         * @method extend
         * @static
         * @param  {string}      name       子组件名
         * @param  {IComponent}  members    子组件的成员
         * @return {IComponentContructor}
         */
        export function extend<T extends IComponent>(name: string | T, members?: T) {
            if (arguments.length === 1 && util.isObject(name)) {
                members = arguments[0];
                name = members.name;
            }
            else {
                members.name = arguments[0];
            }

            var _super = this;
            var prototype = Object.create(_super.prototype);

            var component: IComponentContructor<T> = function(...args: any[]) {
                _super.apply(this, args);
            };

            util.extend(prototype, members);

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
         * @method reigster
         * @static
         * @param  {string}   name          组件名
         * @param  {function} componentCtor 组件类
         */
        export function register(name: string, componentCtor: any) {
            console.assert(name.indexOf('-') > -1, name, '组件明必须在中间带"-"字符,如"custom-view"');

            if (definedComponentMap[name] != null) {
                console.warn('组件 "' + name + '" 已被覆盖,请确认该操作');
            }

            componentCtor.extend = Component.extend;
            definedComponentMap[name] = componentCtor;

            addHiddenStyleForComponent(name);
        }

        let record: { [name: string]: boolean } = {};
        let styleSheet: any;
        
        /**
         * 设置样式
         * @method addHiddenStyleForComponent
         * @private
         * @param  {string} name  组件名
         */
        function addHiddenStyleForComponent(name: string) {
            if (record[name]) {
                return;
            }

            if (!styleSheet) {
                let styleElement = document.createElement('style');
                document.head.appendChild(styleElement);
                styleSheet = styleElement.sheet;
            }

            styleSheet.insertRule(name + '{display:none}', styleSheet.cssRules.length);
        }
        
        // 注册内置的组件标签
        register(config.prefix + 'view', Component);
    }
}