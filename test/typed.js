'use strict';

var test = require('tape');

var qs = require('../');

test('typed stringify: each type gets its own marker', function (t) {
    var out = qs.stringify({
        n: 1.5,
        b: true,
        f: false,
        s: 'hello',
        e: '',
        z: null
    }, { typed: true });

    t.ok(out.indexOf('n=_n_1.5') > -1, 'number is tagged with _n_ and keeps its numeric text');
    t.ok(out.indexOf('b=_b_1') > -1, 'true is tagged with _b_1');
    t.ok(out.indexOf('f=_b_0') > -1, 'false is tagged with _b_0, not treated as empty');
    t.ok(out.indexOf('s=_s_hello') > -1, 'string is tagged with _s_');
    t.ok(out.indexOf('e=_e_') > -1, 'empty string is tagged with _e_');
    t.ok(out.indexOf('z=_z_') > -1, 'null is tagged with _z_');

    var parts = out.split('&');
    t.equal(parts.length, 6, 'markers do not swallow keys or values');
    t.end();
});

test('typed round-trip: leaf types restore exactly', function (t) {
    var input = {
        'int': 42,
        neg: -7,
        'float': 0.1,
        exp: 1e21,
        yes: true,
        no: false,
        str: 'abc',
        empty: '',
        nothing: null
    };
    var result = qs.parse(qs.stringify(input, { typed: true }), { typed: true });
    t.deepEqual(result, input, 'all leaf types round-trip');
    t.strictEqual(typeof result['int'], 'number', 'number stays a number');
    t.strictEqual(typeof result.yes, 'boolean', 'boolean stays a boolean');
    t.strictEqual(result.no, false, 'false does not become null/empty');
    t.strictEqual(result.empty, '', 'empty string stays an empty string');
    t.strictEqual(result.nothing, null, 'null stays null');
    t.end();
});

test('typed round-trip: special numbers', function (t) {
    var result = qs.parse(qs.stringify({ n: 0, i: Infinity, ni: -Infinity }, { typed: true }), { typed: true });
    t.strictEqual(result.n, 0, 'zero round-trips');
    t.strictEqual(result.i, Infinity, 'Infinity round-trips');
    t.strictEqual(result.ni, -Infinity, '-Infinity round-trips');

    var nanResult = qs.parse(qs.stringify({ x: NaN }, { typed: true }), { typed: true });
    t.ok(isNaN(nanResult.x), 'NaN round-trips');
    t.end();
});

test('typed placeholders: empty array, object, string, null stay distinct', function (t) {
    var out = qs.stringify({ a: [], o: {}, e: '', z: null }, { typed: true });
    t.ok(out.indexOf('a=_A_') > -1, 'empty array uses _A_');
    t.ok(out.indexOf('o=_O_') > -1, 'empty object uses _O_');
    t.ok(out.indexOf('e=_e_') > -1, 'empty string uses _e_');
    t.ok(out.indexOf('z=_z_') > -1, 'null uses _z_');

    var result = qs.parse(out, { typed: true });
    t.ok(Array.isArray(result.a) && result.a.length === 0, 'empty array reads back as empty array');
    t.deepEqual(result.o, {}, 'empty object reads back as empty object');
    t.notOk(Array.isArray(result.o), 'empty object is not an array');
    t.strictEqual(result.e, '', 'empty string does not become null');
    t.strictEqual(result.z, null, 'null does not become empty string');
    t.end();
});

test('typed round-trip: nested mixed structures keep their types per level', function (t) {
    var input = {
        deep: {
            list: [1, 'two', false, null, { inner: [3.5, 'x'] }],
            obj: { arr: [{ leaf: 'y' }, [true]], num: 9 }
        },
        top: [[1, 2], { k: 'v' }]
    };
    var result = qs.parse(qs.stringify(input, { typed: true }), { typed: true });
    t.deepEqual(result, input, 'deep mixed structure round-trips exactly');
    t.ok(Array.isArray(result.deep.list), 'deep array is not flattened into an object');
    t.ok(Array.isArray(result.deep.obj.arr[1]), 'array nested inside object inside array stays an array');
    t.strictEqual(result.deep.list[0], 1, 'deep number keeps its type');
    t.strictEqual(result.deep.list[2], false, 'deep boolean keeps its type');
    t.strictEqual(result.deep.list[3], null, 'deep null keeps its type');
    t.end();
});

test('typed + charset: markers survive charset switching', function (t) {
    var input = { n: 5, s: 'üñïçødé ✓', b: true, z: null };

    var iso = qs.stringify(input, { typed: true, charset: 'iso-8859-1' });
    t.ok(iso.indexOf('n=_n_5') > -1, 'marker is intact under iso-8859-1');
    var isoResult = qs.parse(iso, { typed: true, charset: 'iso-8859-1', interpretNumericEntities: true });
    t.deepEqual(isoResult, input, 'iso-8859-1 typed round-trip preserves types and values');

    var utf = qs.stringify(input, { typed: true, charset: 'utf-8', charsetSentinel: true });
    var utfResult = qs.parse(utf, { typed: true, charsetSentinel: true });
    t.deepEqual(utfResult, input, 'utf-8 typed round-trip with charset sentinel preserves types');

    t.end();
});

test('typed + escaping: marker characters inside content are not swallowed', function (t) {
    var input = {
        looksLikeMarker: '_n_5',
        tildes: '~n~ ~b_1',
        percent: '100%_z_',
        brackets: 'a[b]=_O_'
    };
    var out = qs.stringify(input, { typed: true });
    t.ok(out.indexOf('looksLikeMarker=_s__n_5') > -1, 'string content that looks like a marker is wrapped in _s_');

    var result = qs.parse(out, { typed: true });
    t.deepEqual(result, input, 'escaped content round-trips without marker confusion');

    t.deepEqual(
        qs.parse('x=%5Fn%5F5', { typed: true }),
        { x: '_n_5' },
        'percent-escaped marker-like content is treated as content, not a marker'
    );
    t.end();
});

test('typed parse: type mismatches report key, written value, and decoded value', function (t) {
    t['throws'](
        function () { qs.parse('age=_n_abc', { typed: true }); },
        /TypeError.*"age".*_n_abc.*abc/,
        'bad number reports the key, the written value, and the decoded value'
    );
    t['throws'](
        function () { qs.parse('flag=_b_maybe', { typed: true }); },
        /"flag".*_b_maybe.*maybe/,
        'bad boolean reports the key, the written value, and the decoded value'
    );
    t.end();
});

test('typed option off: old behavior is unchanged', function (t) {
    t.equal(qs.stringify({ a: 1, b: true, c: null }), 'a=1&b=true&c=', 'untagged stringify is untouched');
    t.deepEqual(qs.parse('a=_n_1'), { a: '_n_1' }, 'untagged parse treats markers as plain text');
    t.deepEqual(qs.parse('a=1&b=true&c='), { a: '1', b: 'true', c: '' }, 'old parse rules still apply');
    t.deepEqual(
        qs.parse(qs.stringify({ a: [1, 2], b: { c: 'd' } })),
        { a: ['1', '2'], b: { c: 'd' } },
        'untagged write/read round-trip still works the old way'
    );
    t.end();
});

test('typed option validation', function (t) {
    t['throws'](function () { qs.stringify({ a: 1 }, { typed: 'yes' }); }, TypeError, 'stringify rejects non-boolean typed');
    t['throws'](function () { qs.parse('a=1', { typed: 'yes' }); }, TypeError, 'parse rejects non-boolean typed');
    t.end();
});
