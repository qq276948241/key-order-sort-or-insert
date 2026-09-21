'use strict';

var test = require('tape');

var qs = require('../');

test('types option: validation', function (t) {
    t['throws'](function () { qs.stringify({ a: 1 }, { types: 'yes' }); }, TypeError, 'stringify rejects non-boolean types option');
    t['throws'](function () { qs.parse('a=1', { types: 'yes' }); }, TypeError, 'parse rejects non-boolean types option');
    t.end();
});

test('types option: stringify leaves a distinct marker for every type', function (t) {
    var out = qs.stringify({
        str: 'x',
        num: 1.5,
        boolT: true,
        boolF: false,
        nil: null,
        arr: [1],
        obj: { a: 1 },
        emptyArr: [],
        emptyObj: {},
        emptyStr: ''
    }, { types: true });

    t.ok(out.indexOf('str=s!x') > -1, 'string marker');
    t.ok(out.indexOf('num=n!1.5') > -1, 'number marker');
    t.ok(out.indexOf('boolT=b!true') > -1, 'boolean true marker');
    t.ok(out.indexOf('boolF=b!false') > -1, 'boolean false marker');
    t.ok(out.indexOf('nil=z!') > -1, 'null marker');
    t.ok(out.indexOf('arr!a[0]=n!1') > -1, 'array container marker');
    t.ok(out.indexOf('obj!o[a]=n!1') > -1, 'object container marker');
    t.ok(out.indexOf('emptyArr!a=e!a') > -1, 'empty array placeholder');
    t.ok(out.indexOf('emptyObj!o=e!o') > -1, 'empty object placeholder');
    t.ok(out.indexOf('emptyStr=s!') > -1, 'empty string keeps string marker');
    t.end();
});

test('types option: round-trips every type', function (t) {
    var input = {
        str: 'hello',
        num: 42.5,
        neg: -7,
        boolT: true,
        boolF: false,
        nil: null,
        emptyArr: [],
        emptyObj: {},
        emptyStr: '',
        arr: [1, 'two', false, null, []],
        obj: { a: 1, b: { c: [1, { d: 'x' }] } }
    };

    var str = qs.stringify(input, { types: true });
    var back = qs.parse(str, { types: true, depth: 10 });

    t.deepEqual(back, input, 'parsed value deep-equals the written value');
    t.strictEqual(typeof back.num, 'number', 'number stays a number');
    t.strictEqual(typeof back.str, 'string', 'string stays a string');
    t.strictEqual(back.boolF, false, 'false is not treated as empty');
    t.strictEqual(back.nil, null, 'null round-trips');
    t.ok(Array.isArray(back.emptyArr), 'empty array stays an array');
    t.ok(back.emptyObj && typeof back.emptyObj === 'object' && !Array.isArray(back.emptyObj), 'empty object stays an object');
    t.strictEqual(back.emptyStr, '', 'empty string does not become null');
    t.ok(Array.isArray(back.obj.b.c), 'nested array is not flattened into an object');
    t.ok(Array.isArray(back.arr[4]), 'nested empty array inside array stays an array');
    t.end();
});

test('types option: markers survive escaping and charset switches', function (t) {
    var input = {
        tricky: 's!n!b!z!e!a!o 100% & = !',
        unicode: '中文✓',
        key: { 'we!ird[key]': 'v!1' }
    };

    var utf8 = qs.stringify(input, { types: true });
    t.deepEqual(qs.parse(utf8, { types: true }), input, 'utf-8: marker-like content is not confused with markers');

    var isoInput = { tricky: 's!n! 100% !a!o', accent: 'héllo' };
    var iso = qs.stringify(isoInput, { types: true, charset: 'iso-8859-1' });
    t.ok(iso.indexOf('tricky=s!') === 0, 'iso-8859-1: marker is still readable after encoding');
    t.deepEqual(qs.parse(iso, { types: true, charset: 'iso-8859-1' }), isoInput, 'iso-8859-1 round-trips');

    var sentinel = qs.stringify(isoInput, { types: true, charset: 'iso-8859-1', charsetSentinel: true });
    t.deepEqual(qs.parse(sentinel, { types: true, charsetSentinel: true }), isoInput, 'charset sentinel is honored in typed mode');
    t.end();
});

test('types option: parse reports key, written and read values on mismatch', function (t) {
    t['throws'](
        function () { qs.parse('a=n!abc', { types: true }); },
        /type mismatch at key "a".*number.*string \("abc"\)/,
        'number marker with non-numeric content names the key and both sides'
    );
    t['throws'](
        function () { qs.parse('a=b!yes', { types: true }); },
        /type mismatch at key "a".*boolean/,
        'boolean marker with non-boolean content'
    );
    t['throws'](
        function () { qs.parse('a!a[b]=s!x', { types: true }); },
        /type mismatch at key "a\[b\]".*array.*object/,
        'array marker on an object structure'
    );
    t['throws'](
        function () { qs.parse('a=e!x', { types: true }); },
        /unknown empty placeholder/,
        'unknown empty placeholder is rejected'
    );
    t.end();
});

test('types option: untyped behavior is unchanged', function (t) {
    t.equal(qs.stringify({ a: 1, b: { c: 2 } }), 'a=1&b%5Bc%5D=2', 'stringify without types is untouched');
    t.deepEqual(qs.parse('a=1&b[c]=2'), { a: '1', b: { c: '2' } }, 'parse without types is untouched');
    t.deepEqual(qs.parse('a=1&a=2', { types: true }), { a: ['1', '2'] }, 'unmarked parts still follow old rules in typed mode');
    t.deepEqual(qs.parse('a=b!1', { types: false }), { a: 'b!1' }, 'markers are plain data when types is off');
    t.end();
});
