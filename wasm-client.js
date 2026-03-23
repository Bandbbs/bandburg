// WASM客户端 - 在浏览器中直接调用WASM函数
class WasmClient {
    constructor() {
        this.wasmModule = null;
        this.isInitialized = false;
        this.eventCallbacks = new Map();
    }

    async init() {
        if (this.isInitialized) return;
        
        try {
            // 动态导入WASM模块
            const wasmPath = '/wasm/astrobox_ng_wasm.js';
            const wasmFile = '/wasm/astrobox_ng_wasm_bg.wasm';
            
            // 加载WASM模块
            const module = await import(wasmPath);
            
            // 初始化WASM
            await module.default({
                locateFile: (path) => {
                    if (path.endsWith('.wasm')) {
                        return wasmFile;
                    }
                    return path;
                }
            });
            
            this.wasmModule = module;
            this.isInitialized = true;
            
            console.log('WASM模块初始化成功');
            return true;
        } catch (error) {
            console.error('WASM模块初始化失败:', error);
            return false;
        }
    }

    // 注册事件回调
    on(event, callback) {
        if (!this.eventCallbacks.has(event)) {
            this.eventCallbacks.set(event, []);
        }
        this.eventCallbacks.get(event).push(callback);
        
        // 设置事件接收器（如果尚未设置）
        this.setupEventSink();
    }

    // 触发事件
    emit(event, data) {
        // 触发特定事件
        const callbacks = this.eventCallbacks.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(data));
        }
        
        // 触发通配符事件
        const wildcardCallbacks = this.eventCallbacks.get('*');
        if (wildcardCallbacks) {
            wildcardCallbacks.forEach(callback => callback({ event, ...data }));
        }
    }

    // 设置事件接收器
    setupEventSink() {
        // 防止重复设置
        if (this._eventSinkSetup) {
            return;
        }
        
        // 设置 WASM 事件接收器（如果支持）
        if (this.wasmModule && this.wasmModule.register_event_sink) {
            try {
                this.wasmModule.register_event_sink((event, payload) => {
                    console.log('收到WASM事件:', event, payload);
                    this.emit(event, payload);
                });
                
                console.log('WASM事件接收器已设置 (register_event_sink)');
            } catch (error) {
                console.error('设置WASM事件接收器失败:', error);
            }
        }
        
        // 设置控制台日志捕获来捕获 WASM 日志输出
        this.setupConsoleCapture();
        
        this._eventSinkSetup = true;
    }
    
    // 设置控制台捕获
    setupConsoleCapture() {
        // 防止重复设置控制台捕获
        if (this._consoleCaptureSetup) {
            return;
        }
        
        const originalConsoleLog = console.log;
        const originalConsoleInfo = console.info;
        const self = this;
        
        // 捕获 console.log
        console.log = function(...args) {
            originalConsoleLog.apply(console, args);
            self.processWasmLog(args);
        };
        
        // 捕获 console.info
        console.info = function(...args) {
            originalConsoleInfo.apply(console, args);
            self.processWasmLog(args);
        };
        
        this._consoleCaptureSetup = true;
        console.log('WASM控制台日志捕获已启用');
    }
    
    // 处理 WASM 日志
    processWasmLog(args) {
        const logMessage = args.join(' ');
        
        // 捕获第三方应用消息
        if (logMessage.includes('[WASM] Received third-party app message from')) {
            try {
                const parts = logMessage.split('[WASM] Received third-party app message from ');
                if (parts.length > 1) {
                    const packagePart = parts[1].split(': ');
                    const packageName = packagePart[0];
                    const messageContent = packagePart[1];
                    
                    // 尝试解析 JSON 消息
                    let parsedData;
                    try {
                        parsedData = JSON.parse(messageContent);
                    } catch (e) {
                        parsedData = messageContent;
                    }
                    
                    // 创建事件数据
                    const eventData = {
                        type: 'thirdpartyapp_message',
                        package_name: packageName,
                        data: parsedData,
                        rawMessage: logMessage,
                        timestamp: Date.now()
                    };
                    
                    this.emit('thirdpartyapp_message', eventData);
                    this.emit('*', eventData);
                    console.log('已捕获第三方应用消息事件:', eventData);
                }
            } catch (error) {
                console.warn('解析 WASM 应用消息日志失败:', error);
            }
        }
        
        // 捕获数据包事件
        if (logMessage.includes('[WASM] on_pb_packet:')) {
            try {
                const parts = logMessage.split('[WASM] on_pb_packet: ');
                if (parts.length > 1) {
                    const packetData = JSON.parse(parts[1]);
                    const eventData = {
                        type: 'pb_packet',
                        packet: packetData,
                        rawMessage: logMessage,
                        timestamp: Date.now()
                    };
                    
                    this.emit('pb_packet', eventData);
                    this.emit('*', eventData);
                    console.log('已捕获数据包事件:', eventData);
                }
            } catch (error) {
                console.warn('解析 WASM 数据包日志失败:', error);
            }
        }
        
        // 捕获设备连接事件
        if (logMessage.includes('[WASM] Device connected:') || logMessage.includes('[WASM] 设备已连接:')) {
            const eventData = {
                type: 'device_connected',
                message: logMessage,
                timestamp: Date.now()
            };
            
            this.emit('device_connected', eventData);
            this.emit('*', eventData);
        }
        
        // 捕获设备断开事件
        if (logMessage.includes('[WASM] Device disconnected:') || logMessage.includes('[WASM] 设备已断开:')) {
            const eventData = {
                type: 'device_disconnected',
                message: logMessage,
                timestamp: Date.now()
            };
            
            this.emit('device_disconnected', eventData);
            this.emit('*', eventData);
        }
    }

    // 调用WASM函数
    async call(command, args = {}) {
        if (!this.isInitialized) {
            await this.init();
        }
        
        if (!this.wasmModule) {
            throw new Error('WASM模块未初始化');
        }
        
        try {
            console.log(`调用WASM命令: ${command}`, args);
            
            let result;
            switch (command) {
                case 'miwear_connect':
                    result = await this.wasmModule.miwear_connect(
                        args.name || '',
                        args.addr || '',
                        args.authkey || '',
                        args.sar_version || args.sarVersion || 2,
                        args.connect_type || args.connectType || 'SPP'
                    );
                    break;
                    
                case 'miwear_disconnect':
                    result = await this.wasmModule.miwear_disconnect(args.addr || '');
                    break;
                    
                case 'miwear_get_connected_devices':
                    result = await this.wasmModule.miwear_get_connected_devices();
                    break;
                    
                case 'miwear_get_data':
                    const dataType = args.type || args.data_type || 'info';
                    if (!args.addr) {
                        throw new Error('设备地址不能为空');
                    }
                    result = await this.wasmModule.miwear_get_data(
                        args.addr,
                        dataType
                    );
                    break;
                    
                case 'watchface_get_list':
                    result = await this.wasmModule.watchface_get_list(args.addr || '');
                    break;
                    
                case 'watchface_set_current':
                    result = await this.wasmModule.watchface_set_current(
                        args.addr || '',
                        args.watchface_id || args.watchfaceId || args.id || ''
                    );
                    break;
                    
                case 'watchface_uninstall':
                    result = await this.wasmModule.watchface_uninstall(
                        args.addr || '',
                        args.watchface_id || args.watchfaceId || args.id || ''
                    );
                    break;
                    
                case 'thirdpartyapp_get_list':
                    result = await this.wasmModule.thirdpartyapp_get_list(args.addr || '');
                    break;
                    
                case 'thirdpartyapp_send_message':
                    result = await this.wasmModule.thirdpartyapp_send_message(
                        args.addr || '',
                        args.package_name || args.packageName || '',
                        args.data || ''
                    );
                    break;
                    
                case 'thirdpartyapp_launch':
                    result = await this.wasmModule.thirdpartyapp_launch(
                        args.addr || '',
                        args.package_name || args.packageName || '',
                        args.page || ''
                    );
                    break;
                    
                case 'thirdpartyapp_uninstall':
                    result = await this.wasmModule.thirdpartyapp_uninstall(
                        args.addr || '',
                        args.package_name || args.packageName || ''
                    );
                    break;
                    
                case 'miwear_install':
                    if (!args.data || !(args.data instanceof Uint8Array)) {
                        throw new Error('安装需要Uint8Array格式的数据');
                    }
                    
                    result = await this.wasmModule.miwear_install(
                        args.addr || '',
                        args.res_type || args.resType || 0,
                        args.data,
                        args.package_name || args.packageName || null,
                        args.progress_cb || args.progressCb || null
                    );
                    break;
                    
                case 'miwear_get_file_type':
                    if (!args.file || !(args.file instanceof Uint8Array)) {
                        throw new Error('需要Uint8Array格式的文件数据');
                    }
                    
                    result = await this.wasmModule.miwear_get_file_type(
                        args.file,
                        args.name || ''
                    );
                    break;
                    
                default:
                    throw new Error(`不支持的命令: ${command}`);
            }
            
            console.log(`WASM命令 ${command} 返回结果:`, result);
            return result;
            
        } catch (error) {
            console.error(`调用WASM命令 ${command} 失败:`, error);
            console.error('错误详情:', error.stack);
            
            // 提供更友好的错误信息
            let errorMessage = error.message;
            if (error instanceof WebAssembly.Exception) {
                errorMessage = `WASM异常: ${errorMessage}`;
            } else if (error.name === 'RuntimeError') {
                errorMessage = `运行时错误: ${errorMessage}`;
            }
            
            throw new Error(`调用 ${command} 失败: ${errorMessage}`);
        }
    }

    // 辅助方法：将File对象转换为Uint8Array
    async fileToUint8Array(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                resolve(new Uint8Array(reader.result));
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // 辅助方法：获取文件类型
    async getFileType(file, fileName = '') {
        const fileData = await this.fileToUint8Array(file);
        return await this.call('miwear_get_file_type', {
            file: fileData,
            name: fileName || file.name
        });
    }

    // 辅助方法：安装文件
    async installFile(addr, file, resType = 0, packageName = null, progressCallback = null) {
        const fileData = await this.fileToUint8Array(file);
        
        // 创建包装的进度回调函数
        let wrappedProgressCallback = null;
        if (progressCallback && typeof progressCallback === 'function') {
            wrappedProgressCallback = (progressData) => {
                try {
                    console.log('安装进度回调:', progressData);
                    
                    // 处理不同的进度数据格式
                    if (typeof progressData === 'number') {
                        // WASM传回的是0~1的小数，直接传递
                        progressCallback(progressData);
                    } else if (typeof progressData === 'object' && progressData !== null) {
                        // 如果是对象，直接传递
                        progressCallback(progressData);
                    } else {
                        // 如果是其他类型，包装成对象
                        progressCallback({
                            progress: progressData,
                            message: '正在安装...'
                        });
                    }
                } catch (error) {
                    console.error('进度回调执行失败:', error);
                }
            };
        }
        
        console.log('调用miwear_install参数:', {
            addr,
            res_type: resType,
            data_size: fileData.length,
            package_name: packageName,
            has_progress_cb: !!wrappedProgressCallback
        });
        
        return await this.call('miwear_install', {
            addr,
            res_type: resType,
            data: fileData,
            package_name: packageName,
            progress_cb: wrappedProgressCallback
        });
    }
}

// 创建全局WASM客户端实例
window.wasmClient = new WasmClient();

// 导出供其他模块使用
export default window.wasmClient;