var rpc_client_id, Hlclient = function (wsURL) {
    this.wsURL = wsURL;
    this.handlers = {
        _execjs: function (resolve, param) {
            try {
                var startTime = Date.now();
                var timeoutMs = 25000;

                var fn = new Function('return (async () => { ' + param + ' })()');
                var result = fn();

                if (result && typeof result.then === 'function') {
                    var timeoutId = setTimeout(function() {
                        resolve("执行超时: 超过" + (timeoutMs/1000) + "秒");
                    }, timeoutMs);

                    result.then(function(res) {
                        clearTimeout(timeoutId);
                        var execTime = Date.now() - startTime;
                        console.log('JS执行耗时: ' + execTime + 'ms');
                        resolve(res !== undefined ? res : "执行成功(无返回值)");
                    }).catch(function(err) {
                        clearTimeout(timeoutId);
                        resolve("执行错误: " + (err.message || err));
                    });
                } else {
                    var execTime = Date.now() - startTime;
                    console.log('JS执行耗时: ' + execTime + 'ms');
                    resolve(result !== undefined ? result : "执行成功(无返回值)");
                }
            } catch (err) {
                resolve("语法错误: " + (err.message || err));
            }
        }
    };
    this.socket = undefined;
    if (!wsURL) {
        throw new Error('wsURL can not be empty!!')
    }
    this.connect()
}
Hlclient.prototype.connect = function () {
    if (this.wsURL.indexOf("clientId=") === -1 && rpc_client_id) {
        this.wsURL += "&clientId=" + rpc_client_id
    }
    console.log('begin of connect to wsURL: ' + this.wsURL);
    var _this = this;
    var reconnectTimer = null;

    try {
        this.socket = new WebSocket(this.wsURL);
        this.socket.onmessage = function (e) {
            _this.handlerRequest(e.data)
        }
        this.socket.onopen = function (event) {
            console.log("rpc连接成功");
            _this._reportActions();
        };
        this.socket.onerror = function (event) {
            console.error('rpc连接出错,请检查是否打开服务端:', event.error || '未知错误');
        };
        this.socket.onclose = function () {
            console.log('rpc已关闭');
            if (!reconnectTimer) {
                reconnectTimer = setTimeout(function () {
                    reconnectTimer = null;
                    _this.connect()
                }, 10000)
            }
        }
    } catch (e) {
        console.log("connection failed,reconnect after 10s");
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            _this.connect()
        }, 10000)
    }
};
Hlclient.prototype.send = function (msg) {
    this.socket.send(msg)
}
Hlclient.prototype.regAction = function (func_name, func) {
    if (typeof func_name !== 'string') {
        throw new Error("an func_name must be string");
    }
    if (typeof func !== 'function') {
        throw new Error("must be function");
    }
    console.log("register func_name: " + func_name);
    this.handlers[func_name] = func;
    this._reportActions();
    return true
}
Hlclient.prototype._reportActions = function () {
    var actions = Object.keys(this.handlers);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send(JSON.stringify({
            "action": "_registerActions",
            "message_id": "",
            "response_data": JSON.stringify(actions)
        }));
    }
}
Hlclient.prototype.handlerRequest = function (requestJson) {
    var _this = this;
    try {
        var result = JSON.parse(requestJson)
    } catch (error) {
        console.log("请求信息解析错误", requestJson);
        return
    }
    if (result["registerId"]) {
        rpc_client_id = result['registerId']
        return
    }
    if (!result['action'] || !result["message_id"]) {
        console.warn('没有方法或者消息id,不处理');
        return
    }
    var action = result["action"], message_id = result["message_id"]
    var theHandler = this.handlers[action];
    if (!theHandler) {
        this.sendResult(action, message_id, 'action没找到');
        return
    }
    try {
        if (!result["param"]) {
            const async_result = theHandler(function (response) {
                _this.sendResult(action, message_id, response);
            })
            if (async_result && typeof async_result.then === "function") {
                async_result.catch(e => {
                    _this.sendResult(action, message_id, "" + e);
                });
            }
            return
        }
        var param = result["param"]
        try {
            param = JSON.parse(param)
        } catch (e) {
        }
        theHandler(function (response) {
            _this.sendResult(action, message_id, response);
        }, param)
    } catch (e) {
        console.log("error: " + e);
        _this.sendResult(action, message_id, "" + e);
    }
}
Hlclient.prototype.sendResult = function (action, message_id, e) {
    if (typeof e === 'object' && e !== null) {
        try {
            e = JSON.stringify(e)
        } catch (v) {
            console.log(v)
        }
    }
    this.send(JSON.stringify({"action": action, "message_id": message_id, "response_data": e}));
}

//📋 完整的优化说明
// 核心改进点：
// 超时控制 (第8-30行)
//
// 新增25秒客户端超时控制
// 避免超过服务端30秒限制
// 超时时主动返回超时信息
// 性能监控 (第20, 27行)
//
// 添加JS执行耗时日志
// 便于识别性能瓶颈
// 重连优化 (第50-77行)
//
// 修复事件监听器重复绑定问题
// 防止重复重连
// 完善错误处理
// 解决的根本问题：
// 之前：服务端30秒超时 → 消息ID被删除 → 客户端数据丢失
//
// 现在：客户端25秒超时 → 主动返回 → 服务端正常接收响应
//
// 请用此代码替换你的JsEnv_Dev.js文件，然后刷新浏览器重新连接即可！
