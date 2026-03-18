export const id = 213;
export const ids = [213];
export const modules = {

/***/ 413:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.execAsync = void 0;
const child_process = __webpack_require__(5317);
const util = __webpack_require__(9023);
exports.execAsync = util.promisify(child_process.exec);
//# sourceMappingURL=execAsync.js.map

/***/ }),

/***/ 7213:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getMachineId = void 0;
const fs_1 = __webpack_require__(9896);
const execAsync_1 = __webpack_require__(413);
const api_1 = __webpack_require__(1609);
async function getMachineId() {
    try {
        const result = await fs_1.promises.readFile('/etc/hostid', { encoding: 'utf8' });
        return result.trim();
    }
    catch (e) {
        api_1.diag.debug(`error reading machine id: ${e}`);
    }
    try {
        const result = await (0, execAsync_1.execAsync)('kenv -q smbios.system.uuid');
        return result.stdout.trim();
    }
    catch (e) {
        api_1.diag.debug(`error reading machine id: ${e}`);
    }
    return undefined;
}
exports.getMachineId = getMachineId;
//# sourceMappingURL=getMachineId-bsd.js.map

/***/ })

};
