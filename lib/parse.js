'use strict';

var utils = require('./utils');

var has = Object.prototype.hasOwnProperty;
var isArray = Array.isArray;

var defaults = {
    allowDots: false,
    allowEmptyArrays: false,
    allowPrototypes: false,
    allowSparse: false,
    arrayLimit: 20,
    charset: 'utf-8',
    charsetSentinel: false,
    comma: false,
    decodeDotInKeys: false,
    decoder: utils.decode,
    delimiter: '&',
    depth: 5,
    duplicates: 'combine',
    ignoreQueryPrefix: false,
    interpretNumericEntities: false,
    parameterLimit: 1000,
    parseArrays: true,
    plainObjects: false,
    strictDepth: false,
    strictMerge: true,
    strictNullHandling: false,
    throwOnLimitExceeded: false,
    types: false
};

var interpretNumericEntities = function (str) {
    return str.replace(/&#(\d+);/g, function ($0, numberStr) {
        return String.fromCharCode(parseInt(numberStr, 10));
    });
};

var parseArrayValue = function (val, options, currentArrayLength) {
    if (val && typeof val === 'string' && options.comma && val.indexOf(',') > -1) {
        if (options.throwOnLimitExceeded) {
            var commaCount = 0;
            var commaIndex = val.indexOf(',');
            while (commaIndex > -1) {
                commaCount += 1;
                if (commaCount >= options.arrayLimit) {
                    throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
                }
                commaIndex = val.indexOf(',', commaIndex + 1);
            }
        }
        return val.split(',');
    }

    if (options.throwOnLimitExceeded && currentArrayLength >= options.arrayLimit) {
        throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
    }

    return val;
};

// This is what browsers will submit when the ✓ character occurs in an
// application/x-www-form-urlencoded body and the encoding of the page containing
// the form is iso-8859-1, or when the submitted form has an accept-charset
// attribute of iso-8859-1. Presumably also with other charsets that do not contain
// the ✓ character, such as us-ascii.
var isoSentinel = 'utf8=%26%2310003%3B'; // encodeURIComponent('&#10003;')

// These are the percent-encoded utf-8 octets representing a checkmark, indicating that the request actually is utf-8 encoded.
var charsetSentinel = 'utf8=%E2%9C%93'; // encodeURIComponent('✓')

var parseValues = function parseQueryStringValues(str, options) {
    var obj = { __proto__: null };

    var cleanStr = options.ignoreQueryPrefix ? str.replace(/^\?/, '') : str;
    cleanStr = cleanStr.replace(/%5B/gi, '[').replace(/%5D/gi, ']');

    var limit = options.parameterLimit === Infinity ? void undefined : options.parameterLimit;
    var parts = cleanStr.split(
        options.delimiter,
        options.throwOnLimitExceeded && typeof limit !== 'undefined' ? limit + 1 : limit
    );

    if (options.throwOnLimitExceeded && typeof limit !== 'undefined' && parts.length > limit) {
        throw new RangeError('Parameter limit exceeded. Only ' + limit + ' parameter' + (limit === 1 ? '' : 's') + ' allowed.');
    }

    var skipIndex = -1; // Keep track of where the utf8 sentinel was found
    var i;

    var charset = options.charset;
    if (options.charsetSentinel) {
        for (i = 0; i < parts.length; ++i) {
            if (parts[i].indexOf('utf8=') === 0) {
                if (parts[i] === charsetSentinel) {
                    charset = 'utf-8';
                } else if (parts[i] === isoSentinel) {
                    charset = 'iso-8859-1';
                }
                skipIndex = i;
                i = parts.length; // The eslint settings do not allow break;
            }
        }
    }

    for (i = 0; i < parts.length; ++i) {
        if (i === skipIndex) {
            continue;
        }
        var part = parts[i];

        var bracketEqualsPos = part.indexOf(']=');
        var pos = bracketEqualsPos === -1 ? part.indexOf('=') : bracketEqualsPos + 1;

        // `[]` belongs to the key, so look for it at the split point, not anywhere in the part
        var isEmptyBracketKey = pos > 1 && part.slice(pos - 2, pos) === '[]';

        var key;
        var val;
        if (pos === -1) {
            key = options.decoder(part, defaults.decoder, charset, 'key');
            val = options.strictNullHandling ? null : '';
        } else {
            key = options.decoder(part.slice(0, pos), defaults.decoder, charset, 'key');

            if (key !== null) {
                val = utils.maybeMap(
                    parseArrayValue(
                        part.slice(pos + 1),
                        options,
                        isArray(obj[key]) ? obj[key].length : 0
                    ),
                    function (encodedVal) {
                        return options.decoder(encodedVal, defaults.decoder, charset, 'value');
                    }
                );
            }
        }

        if (val && options.interpretNumericEntities && charset === 'iso-8859-1') {
            val = interpretNumericEntities(String(val));
        }

        if (isEmptyBracketKey) {
            val = isArray(val) ? [val] : val;
        }

        if (options.comma && isArray(val) && val.length > options.arrayLimit) {
            val = utils.combine([], val, options.arrayLimit, options.plainObjects, options.throwOnLimitExceeded);
        }

        if (key !== null) {
            var existing = has.call(obj, key);
            if (existing && (options.duplicates === 'combine' || isEmptyBracketKey)) {
                obj[key] = utils.combine(
                    obj[key],
                    val,
                    options.arrayLimit,
                    options.plainObjects,
                    options.throwOnLimitExceeded
                );
            } else if (!existing || options.duplicates === 'last') {
                obj[key] = val;
            }
        }
    }

    return obj;
};

var parseObject = function (chain, val, options, valuesParsed) {
    var currentArrayLength = 0;
    if (chain.length > 0 && chain[chain.length - 1] === '[]') {
        var parentKey = chain.slice(0, -1).join('');
        currentArrayLength = Array.isArray(val) && val[parentKey] ? val[parentKey].length : 0;
    }

    var leaf = valuesParsed ? val : parseArrayValue(val, options, currentArrayLength);

    for (var i = chain.length - 1; i >= 0; --i) {
        var obj;
        var root = chain[i];

        if (root === '[]' && options.parseArrays) {
            if (utils.isOverflow(leaf)) {
                // leaf is already an overflow object, preserve it
                obj = leaf;
            } else {
                obj = options.allowEmptyArrays && (leaf === '' || (options.strictNullHandling && leaf === null))
                    ? []
                    : utils.combine(
                        [],
                        leaf,
                        options.arrayLimit,
                        options.plainObjects,
                        options.throwOnLimitExceeded
                    );
            }
        } else {
            obj = options.plainObjects ? { __proto__: null } : {};
            var cleanRoot = root.charAt(0) === '[' && root.charAt(root.length - 1) === ']' ? root.slice(1, -1) : root;
            var decodedRoot = options.decodeDotInKeys ? cleanRoot.replace(/%2E/g, '.') : cleanRoot;
            var index = parseInt(decodedRoot, 10);
            var isValidArrayIndex = !isNaN(index)
                && root !== decodedRoot
                && String(index) === decodedRoot
                && index >= 0
                && options.parseArrays;
            if (!options.parseArrays && decodedRoot === '') {
                obj = { 0: leaf };
            } else if (isValidArrayIndex && index < options.arrayLimit) {
                obj = [];
                obj[index] = leaf;
            } else if (isValidArrayIndex && options.throwOnLimitExceeded) {
                throw new RangeError('Array limit exceeded. Only ' + options.arrayLimit + ' element' + (options.arrayLimit === 1 ? '' : 's') + ' allowed in an array.');
            } else if (isValidArrayIndex) {
                obj[index] = leaf;
                utils.markOverflow(obj, index);
            } else if (decodedRoot !== '__proto__') {
                obj[decodedRoot] = leaf;
            }
        }

        leaf = obj;
    }

    return leaf;
};

// Split a key like "a[b][c[]]" into ['a', '[b]', '[c[]]'] while preserving
// qs parse semantics for depth/prototype guards.
var splitKeyIntoSegments = function splitKeyIntoSegments(originalKey, options) {
    var key = options.allowDots ? originalKey.replace(/\.([^.[]+)/g, '[$1]') : originalKey;

    // depth <= 0 keeps the whole key as one segment
    if (options.depth <= 0) {
        if (!options.plainObjects && has.call(Object.prototype, key)) {
            if (!options.allowPrototypes) {
                return;
            }
        }

        return [key];
    }

    var segments = [];

    // parent before the first '[' (may be empty if key starts with '[')
    var first = key.indexOf('[');
    var parent = first >= 0 ? key.slice(0, first) : key;
    if (parent) {
        if (!options.plainObjects && has.call(Object.prototype, parent)) {
            if (!options.allowPrototypes) {
                return;
            }
        }

        segments[segments.length] = parent;
    }

    var n = key.length;
    var open = first;
    var collected = 0;

    while (open >= 0 && collected < options.depth) {
        var level = 1;
        var i = open + 1;
        var close = -1;

        // balance nested '[' and ']' inside this bracket group using a nesting level counter
        while (i < n && close < 0) {
            var cu = key.charCodeAt(i);
            if (cu === 0x5B) { // '['
                level += 1;
            } else if (cu === 0x5D) { // ']'
                level -= 1;
                if (level === 0) {
                    close = i; // found matching close; loop will exit by condition
                }
            }
            i += 1;
        }

        if (close < 0) {
            // Unterminated group: wrap the raw remainder in one bracket pair so it stays
            // a single literal segment (e.g. "[[]b" -> "[[]b]"); we do not infer missing ']'.
            segments[segments.length] = '[' + key.slice(open) + ']';
            return segments;
        }

        var seg = key.slice(open, close + 1);
        // prototype guard for the content of this group
        var content = seg.slice(1, -1);
        if (!options.plainObjects && has.call(Object.prototype, content) && !options.allowPrototypes) {
            return;
        }

        segments[segments.length] = seg;
        collected += 1;

        // find the next '[' after this balanced group
        open = key.indexOf('[', close + 1);
    }

    if (open >= 0) {
        if (options.strictDepth === true) {
            throw new RangeError('Input depth exceeded depth option of ' + options.depth + ' and strictDepth is true');
        }

        segments[segments.length] = '[' + key.slice(open) + ']';
    }

    return segments;
};

var parseKeys = function parseQueryStringKeys(givenKey, val, options, valuesParsed) {
    if (!givenKey) {
        return;
    }

    var keys = splitKeyIntoSegments(givenKey, options);

    if (!keys) {
        return;
    }

    return parseObject(keys, val, options, valuesParsed);
};

var normalizeParseOptions = function normalizeParseOptions(opts) {
    if (!opts) {
        return defaults;
    }

    if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
        throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
    }

    if (typeof opts.decodeDotInKeys !== 'undefined' && typeof opts.decodeDotInKeys !== 'boolean') {
        throw new TypeError('`decodeDotInKeys` option can only be `true` or `false`, when provided');
    }

    if (opts.decoder !== null && typeof opts.decoder !== 'undefined' && typeof opts.decoder !== 'function') {
        throw new TypeError('Decoder has to be a function.');
    }

    if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
        throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
    }

    if (typeof opts.throwOnLimitExceeded !== 'undefined' && typeof opts.throwOnLimitExceeded !== 'boolean') {
        throw new TypeError('`throwOnLimitExceeded` option must be a boolean');
    }

    if (typeof opts.types !== 'undefined' && typeof opts.types !== 'boolean') {
        throw new TypeError('`types` option can only be `true` or `false`, when provided');
    }

    var charset = typeof opts.charset === 'undefined' ? defaults.charset : opts.charset;

    var duplicates = typeof opts.duplicates === 'undefined' ? defaults.duplicates : opts.duplicates;

    if (duplicates !== 'combine' && duplicates !== 'first' && duplicates !== 'last') {
        throw new TypeError('The duplicates option must be either combine, first, or last');
    }

    var allowDots = typeof opts.allowDots === 'undefined' ? opts.decodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;

    return {
        allowDots: allowDots,
        allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
        allowPrototypes: typeof opts.allowPrototypes === 'boolean' ? opts.allowPrototypes : defaults.allowPrototypes,
        allowSparse: typeof opts.allowSparse === 'boolean' ? opts.allowSparse : defaults.allowSparse,
        arrayLimit: typeof opts.arrayLimit === 'number' ? opts.arrayLimit : defaults.arrayLimit,
        charset: charset,
        charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
        comma: typeof opts.comma === 'boolean' ? opts.comma : defaults.comma,
        decodeDotInKeys: typeof opts.decodeDotInKeys === 'boolean' ? opts.decodeDotInKeys : defaults.decodeDotInKeys,
        decoder: typeof opts.decoder === 'function' ? opts.decoder : defaults.decoder,
        delimiter: typeof opts.delimiter === 'string' || utils.isRegExp(opts.delimiter) ? opts.delimiter : defaults.delimiter,
        // eslint-disable-next-line no-implicit-coercion, no-extra-parens
        depth: (typeof opts.depth === 'number' || opts.depth === false) ? +opts.depth : defaults.depth,
        duplicates: duplicates,
        ignoreQueryPrefix: opts.ignoreQueryPrefix === true,
        interpretNumericEntities: typeof opts.interpretNumericEntities === 'boolean' ? opts.interpretNumericEntities : defaults.interpretNumericEntities,
        parameterLimit: typeof opts.parameterLimit === 'number' ? opts.parameterLimit : defaults.parameterLimit,
        parseArrays: opts.parseArrays !== false,
        plainObjects: typeof opts.plainObjects === 'boolean' ? opts.plainObjects : defaults.plainObjects,
        strictDepth: typeof opts.strictDepth === 'boolean' ? !!opts.strictDepth : defaults.strictDepth,
        strictMerge: typeof opts.strictMerge === 'boolean' ? !!opts.strictMerge : defaults.strictMerge,
        strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling,
        throwOnLimitExceeded: typeof opts.throwOnLimitExceeded === 'boolean' ? opts.throwOnLimitExceeded : false,
        types: typeof opts.types === 'boolean' ? opts.types : defaults.types
    };
};

var parseMain = function parseMain(str, options) {
    if (str === '' || str === null || typeof str === 'undefined') {
        return options.plainObjects ? { __proto__: null } : {};
    }

    var tempObj = typeof str === 'string' ? parseValues(str, options) : str;
    var obj = options.plainObjects ? { __proto__: null } : {};

    // Iterate over the keys and setup the new object

    var keys = Object.keys(tempObj);
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        var newObj = parseKeys(key, tempObj[key], options, typeof str === 'string');
        obj = utils.merge(obj, newObj, options);
    }

    if (options.allowSparse === true) {
        return obj;
    }

    return utils.compact(obj);
};

// Type markers live at the raw (still percent-encoded) level: `!a` / `!o` at
// the end of a key segment mark an array / object container, and a leading
// `s!` / `n!` / `b!` / `z!` (or `e!a` / `e!o` for empty containers) marks the
// value. Since the encoder percent-encodes any literal `!` in actual content,
// a raw `!` can only ever be a marker, so markers survive escaping and
// charset switches and can never be confused with data.
var typedContainerPattern = /!([ao])(?=\[|\]|$)/g;
var typedValuePattern = /^([a-z])!/;

var typedDescribe = function typedDescribe(value) {
    if (value === null) {
        return 'null';
    }
    if (isArray(value)) {
        return 'array';
    }
    return typeof value;
};

var typedMismatch = function typedMismatch(key, expected, actual) {
    var actualValue = actual !== null && typeof actual === 'object'
        ? typedDescribe(actual)
        : typeof actual === 'string' ? '"' + actual + '"' : String(actual);
    return new TypeError('qs: type mismatch at key "' + key + '": the type marker says "' + expected + '" was written, but the parsed value is ' + typedDescribe(actual) + ' (' + actualValue + ')');
};

var makeContainerStripper = function makeContainerStripper(containers) {
    return function stripContainerMarker($0, marker) {
        containers.push(marker);
        return '';
    };
};

var parseTyped = function parseTyped(str, options) {
    var cleanStr = options.ignoreQueryPrefix ? str.replace(/^\?/, '') : str;

    var charset = options.charset;
    var rawParts = cleanStr.split(options.delimiter);
    var parts = [];
    var i;
    for (i = 0; i < rawParts.length; ++i) {
        if (options.charsetSentinel && rawParts[i].indexOf('utf8=') === 0) {
            if (rawParts[i] === charsetSentinel) {
                charset = 'utf-8';
            } else if (rawParts[i] === isoSentinel) {
                charset = 'iso-8859-1';
            }
            continue;
        }
        parts[parts.length] = rawParts[i];
    }

    var records = [];
    var cleanedParts = [];
    for (i = 0; i < parts.length; ++i) {
        var part = parts[i];
        var pos = part.indexOf('=');
        var rawKey = pos === -1 ? part : part.slice(0, pos);
        var rawVal = pos === -1 ? '' : part.slice(pos + 1);

        var containers = [];
        var cleanKey = rawKey.replace(typedContainerPattern, makeContainerStripper(containers));

        var leaf = null;
        var empty = null;
        var cleanVal = rawVal;
        var vm = typedValuePattern.exec(rawVal);
        if (vm && (vm[1] === 's' || vm[1] === 'n' || vm[1] === 'b' || vm[1] === 'z')) {
            leaf = vm[1];
            cleanVal = rawVal.slice(2);
        } else if (vm && vm[1] === 'e') {
            empty = rawVal.charAt(2);
            if (empty !== 'a' && empty !== 'o') {
                throw new TypeError('qs: unknown empty placeholder "e!' + empty + '" at key "' + cleanKey + '"');
            }
            leaf = 'e';
            cleanVal = '';
        }

        cleanedParts[cleanedParts.length] = pos === -1 ? cleanKey : cleanKey + '=' + cleanVal;
        records[records.length] = {
            containers: containers,
            empty: empty,
            key: cleanKey,
            leaf: leaf
        };
    }

    var joinDelimiter = typeof options.delimiter === 'string' ? options.delimiter : '&';
    var cleanedOptions = utils.assign({}, options);
    cleanedOptions.types = false;
    cleanedOptions.charset = charset;
    cleanedOptions.delimiter = joinDelimiter;
    var result = parseMain(cleanedParts.join(joinDelimiter), cleanedOptions);

    for (i = 0; i < records.length; ++i) {
        var record = records[i];
        if (!record.leaf && record.containers.length === 0) {
            continue;
        }

        var decodedKey = options.decoder(record.key, defaults.decoder, charset, 'key');
        var segments = splitKeyIntoSegments(decodedKey, options);
        if (!segments || segments.length === 0) {
            continue;
        }

        var path = [];
        for (var s = 0; s < segments.length; ++s) {
            var seg = segments[s];
            path[path.length] = seg.charAt(0) === '[' && seg.charAt(seg.length - 1) === ']' ? seg.slice(1, -1) : seg;
        }

        var node = result;
        for (var d = 0; d < path.length - 1; ++d) {
            if (node === null || typeof node !== 'object') {
                throw typedMismatch(decodedKey, 'object', node);
            }
            var child = node[path[d]];
            if (d < record.containers.length) {
                var expected = record.containers[d] === 'a' ? 'array' : 'object';
                var ok = expected === 'array'
                    ? isArray(child)
                    : child !== null && typeof child === 'object' && !isArray(child);
                if (!ok) {
                    throw typedMismatch(decodedKey, expected, child);
                }
            }
            node = child;
        }

        var leafKey = path[path.length - 1];
        var current = node[leafKey];
        if (record.leaf === 'e') {
            node[leafKey] = record.empty === 'a' ? [] : {};
        } else if (record.leaf === 'z') {
            node[leafKey] = null;
        } else if (record.leaf === 'n') {
            var num = typeof current === 'string' && current !== '' ? Number(current) : NaN;
            if (num !== num && current !== 'NaN') {
                throw typedMismatch(decodedKey, 'number', current);
            }
            node[leafKey] = num;
        } else if (record.leaf === 'b') {
            if (current === 'true') {
                node[leafKey] = true;
            } else if (current === 'false') {
                node[leafKey] = false;
            } else {
                throw typedMismatch(decodedKey, 'boolean', current);
            }
        } else if (record.leaf === 's' && typeof current !== 'string') {
            throw typedMismatch(decodedKey, 'string', current);
        }
    }

    return result;
};

module.exports = function (str, opts) {
    var options = normalizeParseOptions(opts);

    if (options.types && typeof str === 'string' && str !== '') {
        return parseTyped(str, options);
    }

    return parseMain(str, options);
};
