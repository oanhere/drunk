/// <reference path="../viewmodel/viewModel.ts" />
/// <reference path="../promise/promise.ts" />
/// <reference path="../util/xhr.ts" />
/// <reference path="../util/elem" />
/// <reference path="../config/config.ts" />
/// <reference path="../parser/parser.ts" />

/**
 * 模板工具模块， 提供编译创建绑定，模板加载的工具方法
 * @module drunk.Template
 * @class Template
 * @main
 */
module drunk.Template {
    
    /**
     * 编译模板元素生成绑定方法
     * @param  {any}        node        模板元素
     * @param  {boolean}    isRootNode  是否是根元素
     * @return {function}               绑定元素与viewModel的方法
     */
    export function compile(node: any): IBindingExecutor {
        var isArray: boolean = Array.isArray(node);
        var executor: IBindingExecutor = isArray || node.nodeType === 11 ? null : compileNode(node);
        var isTerminal: boolean = executor && executor.isTerminal;
        var childExecutor: IBindingExecutor;
        
        if (isArray) {
            executor = compileNodeList(node);
        }
        else if (!isTerminal && node.tagName !== 'SCRIPT' && node.hasChildNodes()) {
            childExecutor = compileNodeList(node.childNodes);
        }
        
        return (viewModel: ViewModel, element: any, parentViewModel?: Component, placeholder?: HTMLElement) => {
            var allBindings = viewModel._bindings;
            var startIndex: number = allBindings.length;
            var bindingList: Binding[];
            
            if (executor) {
                executor(viewModel, element, parentViewModel, placeholder);
            }
            if (childExecutor) {
                childExecutor(viewModel, element.childNodes, parentViewModel, placeholder);
            }
            
            bindingList = viewModel._bindings.slice(startIndex);
        
            return () => {
                bindingList.forEach((binding) => {
                    binding.dispose();
                });
                
                startIndex = allBindings.indexOf(bindingList[0]);
                allBindings.splice(startIndex, bindingList.length);
            };
        };
    }
    
    // 判断元素是什么类型,调用相应的类型编译方法
    function compileNode(node: any): IBindingExecutor {
        var nodeType: number = node.nodeType;
        
        if (nodeType === 1 && node.tagName !== "SCRIPT") {
            // 如果是元素节点
            return compileElement(node);
        }
        if (nodeType === 3) {
            // 如果是textNode
            return compileTextNode(node);
        }
    }
    
    // 编译NodeList
    function compileNodeList(nodeList: any[]): IBindingExecutor {
        var executors: any = [];
        
        util.toArray(nodeList).forEach((node) => {
            var executor: IBindingExecutor;
            var childExecutor: IBindingExecutor;
            
            executor = compileNode(node);
            
            if (!(executor && executor.isTerminal) && node.hasChildNodes()) {
                childExecutor = compileNodeList(node.childNodes);
            }
            
            executors.push(executor, childExecutor);
        });
        
        if (executors.length > 1) {
            return (viewModel: ViewModel, nodes: any, parentViewModel?: Component, placeholder?: HTMLElement) => {
                if (nodes.length * 2 !== executors.length) {
                    throw new Error("创建绑定之前,节点已经被动态修改");
                }
                
                var i = 0;
                var nodeExecutor: IBindingExecutor;
                var childExecutor: IBindingExecutor;
                
                util.toArray(nodes).forEach((node) => {
                    nodeExecutor = executors[i++];
                    childExecutor = executors[i++];
                    
                    if (nodeExecutor) {
                        nodeExecutor(viewModel, node, parentViewModel, placeholder);
                    }
                    if (childExecutor) {
                        childExecutor(viewModel, node.childNodes, parentViewModel, placeholder);
                    }
                });
            };
        }
    }
    
    // 编译元素的绑定并创建绑定描述符
    function compileElement(element: any): IBindingExecutor {
        var executor;
        
        if (element.hasAttributes()) {
            // 如果元素上有属性， 先判断是否存在终止型绑定指令
            // 如果不存在则判断是否有普通的绑定指令
            executor = processTerminalBinding(element) || processNormalBinding(element);
        }
        
        if (element.tagName === 'TEXTAREA') {
            // 如果是textarea， 它的值有可能存在插值表达式， 比如 "the textarea value with {{some_var}}"
            // 第一次进行绑定先换成插值表达式
            var originExecutor = executor;
            
            executor = (viewModel, textarea) => {
                textarea.value = viewModel.eval(textarea.value, true);
                
                if (originExecutor) {
                    originExecutor(viewModel, textarea);
                }
            };
        }
        
        return executor;
    }
    
    // 编译文本节点
    function compileTextNode(node: any): IBindingExecutor {
        var content: string = node.textContent;
        
        if (!parser.hasInterpolation(content)) {
            return;
        }
        
        var tokens: any[] = parser.parseInterpolate(content, true);
        var fragment = document.createDocumentFragment();
        var executors = [];
        
        tokens.forEach((token, i) => {
            if (typeof token === 'string') {
                fragment.appendChild(document.createTextNode(token));
                executors[i] = null;
            }
            else {
                fragment.appendChild(document.createTextNode(' '));
                executors[i] = createExecutor(node, {
                    name: "bind",
                    expression: token.expression
                });
            }
        });
        
        return (viewModel, element) => {
            var frag = fragment.cloneNode(true);
            
            util.toArray(frag.childNodes).forEach((node, i) => {
                if (executors[i]) {
                    executors[i](viewModel, node);
                }
            });
            
            elementUtil.replace(frag, element);
        };
    }
    
    // 检测是否存在终止编译的绑定，比如component指令会终止当前编译过程，如果有创建绑定描述符
    function processTerminalBinding(element: any): IBindingExecutor {
        var terminals: string[] = Binding.getTerminalBindings();
        var name: string;
        var expression: string;
        
        for (var i = 0; name = terminals[i]; i++) {
            if (expression = element.getAttribute(config.prefix + name)) {
                // 如果存在该绑定
                return createExecutor(element, {
                    name: name,
                    expression: expression,
                    isTerminal: true
                });
            }
        }
    }
    
    // 查找并创建通常的绑定
    function processNormalBinding(element: any): IBindingExecutor {
        var executors: IBindingExecutor[] = [];
        
        util.toArray(element.attributes).forEach((attr) => {
            var name: string = attr.name;
            var index: number = name.indexOf(config.prefix);
            var expression: string = attr.value;
            var executor;
            
            if (index > -1 && index < name.length - 1) {
                // 已经注册的绑定
                name = name.slice(index + config.prefix.length);
                executor = createExecutor(element, {
                    name: name,
                    expression: expression
                });
            }
            else if (parser.hasInterpolation(expression)) {
                // 如果是在某个属性上进行插值创建一个attr的绑定
                executor = createExecutor(element, {
                    name: "attr",
                    attrName: name,
                    expression: expression,
                    isInterpolate: true
                });
            }
                
            if (executor) {
                executors.push(executor);
            }
        });
        
        if (executors.length) {
            executors.sort((a, b) => {
                return b.priority - a.priority;
            });
            // 存在绑定
            return (viewModel: Component, element: any, parentViewModel?: Component, placeholder?: HTMLElement) => {
                executors.forEach((executor) => {
                    executor(viewModel, element, parentViewModel, placeholder);
                });
            };
        }
    }
    
    // 生成绑定描述符方法
    function createExecutor(element: any, descriptor: IBindingDefinition): IBindingExecutor {
        var definition = Binding.getDefinintionByName(descriptor.name);
        var executor: IBindingExecutor;
        
        if (!definition && config.debug) {
            console.warn(descriptor.name, "没有找到该绑定的定义");
            return;
        }
        
        if (!definition.retainAttribute && element.removeAttribute) {
            // 如果未声明保留这个绑定属性，则把它移除
            element.removeAttribute(config.prefix + descriptor.name);
        }
        
        util.extend(descriptor, definition);
        
        executor = (viewModel, element, parentViewModel?: Component, placeholder?: HTMLElement) => {
            Binding.create(viewModel, element, descriptor, parentViewModel, placeholder);
        };
        executor.isTerminal = descriptor.isTerminal;
        executor.priority = definition.priority;
        
        return executor;
    }
}