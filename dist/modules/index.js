"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadManyBy = exports.loadOneBy = exports.withBatching = exports.createBatchScope = exports.createBatchLoader = exports.snakeCaseQueryClient = exports.snakeRows = exports.snakeRow = exports.snakeKey = exports.ModulesClient = exports.defineModule = void 0;
var core_1 = require("./core");
Object.defineProperty(exports, "defineModule", { enumerable: true, get: function () { return core_1.defineModule; } });
var modules_client_1 = require("./modules-client");
Object.defineProperty(exports, "ModulesClient", { enumerable: true, get: function () { return modules_client_1.ModulesClient; } });
var row_casing_1 = require("./row-casing");
Object.defineProperty(exports, "snakeKey", { enumerable: true, get: function () { return row_casing_1.snakeKey; } });
Object.defineProperty(exports, "snakeRow", { enumerable: true, get: function () { return row_casing_1.snakeRow; } });
Object.defineProperty(exports, "snakeRows", { enumerable: true, get: function () { return row_casing_1.snakeRows; } });
Object.defineProperty(exports, "snakeCaseQueryClient", { enumerable: true, get: function () { return row_casing_1.snakeCaseQueryClient; } });
var batch_1 = require("./batch");
Object.defineProperty(exports, "createBatchLoader", { enumerable: true, get: function () { return batch_1.createBatchLoader; } });
Object.defineProperty(exports, "createBatchScope", { enumerable: true, get: function () { return batch_1.createBatchScope; } });
Object.defineProperty(exports, "withBatching", { enumerable: true, get: function () { return batch_1.withBatching; } });
Object.defineProperty(exports, "loadOneBy", { enumerable: true, get: function () { return batch_1.loadOneBy; } });
Object.defineProperty(exports, "loadManyBy", { enumerable: true, get: function () { return batch_1.loadManyBy; } });
//# sourceMappingURL=index.js.map