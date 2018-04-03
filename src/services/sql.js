"use strict";

const log = require('./log');
const cls = require('./cls');

let dbConnection;

function setDbConnection(connection) {
    dbConnection = connection;
}

async function insert(table_name, rec, replace = false) {
    const keys = Object.keys(rec);
    if (keys.length === 0) {
        log.error("Can't insert empty object into table " + table_name);
        return;
    }

    const columns = keys.join(", ");
    const questionMarks = keys.map(p => "?").join(", ");

    const query = "INSERT " + (replace ? "OR REPLACE" : "") + " INTO " + table_name + "(" + columns + ") VALUES (" + questionMarks + ")";

    const res = await execute(query, Object.values(rec));

    return res.lastID;
}

async function replace(table_name, rec) {
    return await insert(table_name, rec, true);
}

async function beginTransaction() {
    return await execute("BEGIN");
}

async function commit() {
    return await execute("COMMIT");
}

async function rollback() {
    return await execute("ROLLBACK");
}

async function getRow(query, params = []) {
    return await wrap(async db => db.get(query, ...params));
}

async function getRowOrNull(query, params = []) {
    const all = await getRows(query, params);

    return all.length > 0 ? all[0] : null;
}

async function getValue(query, params = []) {
    const row = await getRowOrNull(query, params);

    if (!row) {
        return null;
    }

    return row[Object.keys(row)[0]];
}

async function getRows(query, params = []) {
    return await wrap(async db => db.all(query, ...params));
}

async function getMap(query, params = []) {
    const map = {};
    const results = await getRows(query, params);

    for (const row of results) {
        const keys = Object.keys(row);

        map[row[keys[0]]] = row[keys[1]];
    }

    return map;
}

async function getColumn(query, params = []) {
    const list = [];
    const result = await getRows(query, params);

    if (result.length === 0) {
        return list;
    }

    const key = Object.keys(result[0])[0];

    for (const row of result) {
        list.push(row[key]);
    }

    return list;
}

async function execute(query, params = []) {
    return await wrap(async db => db.run(query, ...params));
}

async function executeScript(query) {
    return await wrap(async db => db.exec(query));
}

async function wrap(func) {
    const thisError = new Error();

    try {
        return await func(dbConnection);
    }
    catch (e) {
        log.error("Error executing query. Inner exception: " + e.stack + thisError.stack);

        thisError.message = e.stack;

        throw thisError;
    }
}

let transactionActive = false;
let transactionPromise = null;

async function doInTransaction(func) {
    if (cls.namespace.get('isInTransaction')) {
        return await func();
    }

    while (transactionActive) {
        await transactionPromise;
    }

    let ret = null;
    const error = new Error(); // to capture correct stack trace in case of exception

    transactionActive = true;
    transactionPromise = new Promise(async (resolve, reject) => {
        try {
            cls.namespace.set('isInTransaction', true);

            await beginTransaction();

            ret = await func();

            await commit();

            transactionActive = false;
            resolve();
        }
        catch (e) {
            log.error("Error executing transaction, executing rollback. Inner exception: " + e.stack + error.stack);

            await rollback();

            transactionActive = false;

            reject(e);
        }
        finally {
            cls.namespace.set('isInTransaction', false);
        }
    });

    if (transactionActive) {
        await transactionPromise;
    }

    return ret;
}

module.exports = {
    setDbConnection,
    insert,
    replace,
    getValue,
    getRow,
    getRowOrNull,
    getRows,
    getMap,
    getColumn,
    execute,
    executeScript,
    doInTransaction
};