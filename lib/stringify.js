'use strict';

var getSideChannel = require('side-channel');
var utils = require('./utils');
var formats = require('./formats');
var has = Object.prototype.hasOwnProperty;

var arrayPrefixGenerators = {
    brackets: function brackets(prefix) {
        return prefix + '[]';
    },
    comma: 'comma',
    indices: function indices(prefix, key) {
        return prefix + '[' + key + ']';
    },
    repeat: function repeat(prefix) {
        return prefix;
    }
};

var isArray = Array.isArray;
var push = Array.prototype.push;
var pushToArray = function (arr, valueOrArray) {
    push.apply(arr, isArray(valueOrArray) ? valueOrArray : [valueOrArray]);
};

var toISO = Date.prototype.toISOString;

var defaultFormat = formats['default'];
var defaults = {
    addQueryPrefix: false,
    allowDots: false,
    allowEmptyArrays: false,
    arrayFormat: 'indices',
    charset: 'utf-8',
    charsetSentinel: false,
    commaRoundTrip: false,
    delimiter: '&',
    depth: Infinity,
    encode: true,
    encodeDotInKeys: false,
    encoder: utils.encode,
    encodeValuesOnly: false,
    filter: void undefined,
    format: defaultFormat,
    formatter: formats.formatters[defaultFormat],
    // deprecated
    indices: false,
    serializeDate: function serializeDate(date) {
        return toISO.call(date);
    },
    skipNulls: false,
    strictNullHandling: false,
    typed: false
};

// Typed round-trip markers. Markers are pure ASCII and are prepended to the
// *encoded* value, so they survive both utf-8 and iso-8859-1 charset encoding
// and can never be confused with percent-escaped content.
var typedMarkers = {
    'boolean': '_b_',
    emptyArray: '_A_',
    emptyObject: '_O_',
    emptyString: '_e_',
    'null': '_z_',
    number: '_n_',
    string: '_s_'
};

var typedLeaf = function typedLeaf(value, encoder, charset, format) {
    if (value === null) {
        return typedMarkers['null'];
    }
    if (typeof value === 'number') {
        var numberText = String(value);
        // run the number text through the encoder so e.g. the "+" in 1e+21
        // is percent-escaped instead of being read back as a space
        var encodedNumber = encoder ? encoder(numberText, defaults.encoder, charset, 'value', format) : numberText;
        return typedMarkers.number + encodedNumber;
    }
    if (typeof value === 'boolean') {
        return typedMarkers['boolean'] + (value ? '1' : '0');
    }
    var stringValue = typeof value === 'string' ? value : String(value);
    if (stringValue.length === 0) {
        return typedMarkers.emptyString;
    }
    var encoded = encoder ? encoder(stringValue, defaults.encoder, charset, 'value', format) : stringValue;
    return typedMarkers.string + encoded;
};

var typedKey = function typedKey(prefix, env) {
    return env.encoder && !env.encodeValuesOnly ? env.encoder(prefix, defaults.encoder, env.charset, 'key', env.format) : prefix;
};

var typedPrimitiveResult = function typedPrimitiveResult(value, prefix, env) {
    var key = typedKey(prefix, env);
    return [env.formatter(key) + '=' + typedLeaf(value, env.encoder, env.charset, env.format)];
};

var typedEmptyResult = function typedEmptyResult(obj, encodedPrefix, env) {
    if (typeof obj !== 'object' || obj === null || obj instanceof Date || Object.keys(obj).length !== 0) {
        return void undefined;
    }
    var key = typedKey(encodedPrefix, env);
    return [env.formatter(key) + '=' + (isArray(obj) ? typedMarkers.emptyArray : typedMarkers.emptyObject)];
};

var isNonNullishPrimitive = function isNonNullishPrimitive(v) {
    return typeof v === 'string'
        || typeof v === 'number'
        || typeof v === 'boolean'
        || typeof v === 'symbol'
        || typeof v === 'bigint';
};

var sentinel = {};

var makeTypedEnv = function makeTypedEnv(charset, encoder, encodeValuesOnly, format, formatter) {
    return {
        charset: charset,
        encoder: encoder,
        encodeValuesOnly: encodeValuesOnly,
        format: format,
        formatter: formatter
    };
};

var checkCyclic = function checkCyclic(sideChannel, object) {
    var tmpSc = sideChannel;
    var step = 0;
    var findFlag = false;
    while ((tmpSc = tmpSc.get(sentinel)) !== void undefined && !findFlag) {
        // Where object last appeared in the ref tree
        var pos = tmpSc.get(object);
        step += 1;
        if (typeof pos !== 'undefined') {
            if (pos === step) {
                throw new RangeError('Cyclic object value');
            } else {
                findFlag = true; // Break while
            }
        }
        if (typeof tmpSc.get(sentinel) === 'undefined') {
            step = 0;
        }
    }

    return step;
};

var stringify = function stringify(
    object,
    prefix,
    generateArrayPrefix,
    commaRoundTrip,
    allowEmptyArrays,
    strictNullHandling,
    skipNulls,
    encodeDotInKeys,
    encoder,
    filter,
    sort,
    allowDots,
    serializeDate,
    format,
    formatter,
    encodeValuesOnly,
    charset,
    sideChannel,
    depthState
) {
    var obj = object;

    if (depthState.currentDepth > depthState.depth) {
        throw new RangeError('Input depth exceeded depth option of ' + depthState.depth);
    }

    var typed = depthState.typed;

    var typedEnv = makeTypedEnv(charset, encoder, encodeValuesOnly, format, formatter);

    var step = checkCyclic(sideChannel, object);

    obj = typeof filter === 'function' ? filter(prefix, obj) : obj;

    if (obj instanceof Date) {
        obj = serializeDate(obj);
    } else if (generateArrayPrefix === 'comma' && isArray(obj)) {
        obj = utils.maybeMap(obj, function (value) {
            if (value instanceof Date) {
                return serializeDate(value);
            }
            return value;
        });
    }

    if (obj === null) {
        if (typed) {
            return typedPrimitiveResult(null, prefix, typedEnv);
        }
        if (strictNullHandling) {
            return formatter(encoder && !encodeValuesOnly ? encoder(prefix, defaults.encoder, charset, 'key', format) : prefix);
        }

        obj = '';
    }

    if (isNonNullishPrimitive(obj) || utils.isBuffer(obj)) {
        if (typed) {
            return typedPrimitiveResult(obj, prefix, typedEnv);
        }
        if (encoder) {
            var keyValue = encodeValuesOnly ? prefix : encoder(prefix, defaults.encoder, charset, 'key', format);
            return [formatter(keyValue) + '=' + formatter(encoder(obj, defaults.encoder, charset, 'value', format))];
        }
        return [formatter(prefix) + '=' + formatter(String(obj))];
    }

    var values = [];

    if (typeof obj === 'undefined') {
        return values;
    }

    var objKeys;
    if (generateArrayPrefix === 'comma' && isArray(obj)) {
        // we need to join elements in
        if (encodeValuesOnly && encoder) {
            obj = utils.maybeMap(obj, function (v) {
                return v == null ? v : encoder(v);
            });
        }
        objKeys = [{ value: obj.length > 0 ? obj.join(',') || null : void undefined }];
    } else if (isArray(filter)) {
        objKeys = filter;
    } else {
        var keys = Object.keys(obj);
        objKeys = sort ? keys.sort(sort) : keys;
    }

    var encodedPrefix = encodeDotInKeys ? String(prefix).replace(/\./g, '%2E') : String(prefix);

    var adjustedPrefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encodedPrefix + '[]' : encodedPrefix;

    var emptyResult = typed ? typedEmptyResult(obj, encodedPrefix, typedEnv) : void undefined;
    if (emptyResult) {
        return emptyResult;
    }

    if (allowEmptyArrays && isArray(obj) && obj.length === 0 && Object.keys(obj).length === 0) {
        return adjustedPrefix + '[]';
    }

    for (var j = 0; j < objKeys.length; ++j) {
        var key = objKeys[j];
        var value = typeof key === 'object' && key && typeof key.value !== 'undefined'
            ? key.value
            : obj[key];

        if (skipNulls && value === null) {
            continue;
        }

        var encodedKey = allowDots && encodeDotInKeys ? String(key).replace(/\./g, '%2E') : String(key);
        var keyPrefix = isArray(obj)
            ? typeof generateArrayPrefix === 'function' ? generateArrayPrefix(adjustedPrefix, encodedKey) : adjustedPrefix
            : adjustedPrefix + (allowDots ? '.' + encodedKey : '[' + encodedKey + ']');

        sideChannel.set(object, step);
        var valueSideChannel = getSideChannel();
        valueSideChannel.set(sentinel, sideChannel);
        pushToArray(values, stringify(
            value,
            keyPrefix,
            generateArrayPrefix,
            commaRoundTrip,
            allowEmptyArrays,
            strictNullHandling,
            skipNulls,
            encodeDotInKeys,
            generateArrayPrefix === 'comma' && encodeValuesOnly && isArray(obj) ? null : encoder,
            filter,
            sort,
            allowDots,
            serializeDate,
            format,
            formatter,
            encodeValuesOnly,
            charset,
            valueSideChannel,
            {
                currentDepth: depthState.currentDepth + 1,
                depth: depthState.depth,
                typed: typed
            }
        ));
    }

    return values;
};

var normalizeStringifyOptions = function normalizeStringifyOptions(opts) {
    if (!opts) {
        return defaults;
    }

    if (typeof opts.allowEmptyArrays !== 'undefined' && typeof opts.allowEmptyArrays !== 'boolean') {
        throw new TypeError('`allowEmptyArrays` option can only be `true` or `false`, when provided');
    }

    if (typeof opts.encodeDotInKeys !== 'undefined' && typeof opts.encodeDotInKeys !== 'boolean') {
        throw new TypeError('`encodeDotInKeys` option can only be `true` or `false`, when provided');
    }

    if (opts.encoder !== null && typeof opts.encoder !== 'undefined' && typeof opts.encoder !== 'function') {
        throw new TypeError('Encoder has to be a function.');
    }

    var charset = opts.charset || defaults.charset;
    if (typeof opts.charset !== 'undefined' && opts.charset !== 'utf-8' && opts.charset !== 'iso-8859-1') {
        throw new TypeError('The charset option must be either utf-8, iso-8859-1, or undefined');
    }

    var format = formats['default'];
    if (typeof opts.format !== 'undefined') {
        if (!has.call(formats.formatters, opts.format)) {
            throw new TypeError('Unknown format option provided.');
        }
        format = opts.format;
    }
    var formatter = formats.formatters[format];

    var filter = defaults.filter;
    if (typeof opts.filter === 'function' || isArray(opts.filter)) {
        filter = opts.filter;
    }

    var arrayFormat;
    if (opts.arrayFormat in arrayPrefixGenerators) {
        arrayFormat = opts.arrayFormat;
    } else if ('indices' in opts) {
        arrayFormat = opts.indices ? 'indices' : 'repeat';
    } else {
        arrayFormat = defaults.arrayFormat;
    }

    if ('commaRoundTrip' in opts && typeof opts.commaRoundTrip !== 'boolean') {
        throw new TypeError('`commaRoundTrip` must be a boolean, or absent');
    }

    if ('typed' in opts && typeof opts.typed !== 'boolean') {
        throw new TypeError('`typed` must be a boolean, or absent');
    }

    var allowDots = typeof opts.allowDots === 'undefined' ? opts.encodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;

    return {
        addQueryPrefix: typeof opts.addQueryPrefix === 'boolean' ? opts.addQueryPrefix : defaults.addQueryPrefix,
        allowDots: allowDots,
        allowEmptyArrays: typeof opts.allowEmptyArrays === 'boolean' ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
        arrayFormat: arrayFormat,
        charset: charset,
        charsetSentinel: typeof opts.charsetSentinel === 'boolean' ? opts.charsetSentinel : defaults.charsetSentinel,
        commaRoundTrip: !!opts.commaRoundTrip,
        delimiter: typeof opts.delimiter === 'undefined' ? defaults.delimiter : opts.delimiter,
        depth: typeof opts.depth === 'number' ? opts.depth : defaults.depth,
        encode: typeof opts.encode === 'boolean' ? opts.encode : defaults.encode,
        encodeDotInKeys: typeof opts.encodeDotInKeys === 'boolean' ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
        encoder: typeof opts.encoder === 'function' ? opts.encoder : defaults.encoder,
        encodeValuesOnly: typeof opts.encodeValuesOnly === 'boolean' ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
        filter: filter,
        format: format,
        formatter: formatter,
        serializeDate: typeof opts.serializeDate === 'function' ? opts.serializeDate : defaults.serializeDate,
        skipNulls: typeof opts.skipNulls === 'boolean' ? opts.skipNulls : defaults.skipNulls,
        sort: typeof opts.sort === 'function' ? opts.sort : null,
        strictNullHandling: typeof opts.strictNullHandling === 'boolean' ? opts.strictNullHandling : defaults.strictNullHandling,
        typed: typeof opts.typed === 'boolean' ? opts.typed : defaults.typed
    };
};

module.exports = function (object, opts) {
    var obj = object;
    var options = normalizeStringifyOptions(opts);

    var objKeys;
    var filter;

    if (typeof options.filter === 'function') {
        filter = options.filter;
        obj = filter('', obj);
    } else if (isArray(options.filter)) {
        filter = options.filter;
        objKeys = filter;
    }

    var keys = [];

    if (typeof obj !== 'object' || obj === null) {
        return '';
    }

    var generateArrayPrefix = arrayPrefixGenerators[options.arrayFormat];
    var commaRoundTrip = generateArrayPrefix === 'comma' && options.commaRoundTrip;

    if (!objKeys) {
        objKeys = Object.keys(obj);
    }

    if (options.sort) {
        objKeys.sort(options.sort);
    }

    var sideChannel = getSideChannel();
    for (var i = 0; i < objKeys.length; ++i) {
        var key = objKeys[i];

        if (typeof key === 'undefined' || key === null) {
            continue;
        }

        var value = obj[key];

        if (options.skipNulls && value === null) {
            continue;
        }

        var encodedKey = options.encodeDotInKeys ? String(key).replace(/\./g, '%2E') : String(key);

        pushToArray(keys, stringify(
            value,
            encodedKey,
            generateArrayPrefix,
            commaRoundTrip,
            options.allowEmptyArrays,
            options.strictNullHandling,
            options.skipNulls,
            options.encodeDotInKeys,
            options.encode ? options.encoder : null,
            options.filter,
            options.sort,
            options.allowDots,
            options.serializeDate,
            options.format,
            options.formatter,
            options.encodeValuesOnly,
            options.charset,
            sideChannel,
            {
                currentDepth: 0,
                depth: options.depth,
                typed: options.typed
            }
        ));
    }

    var joined = keys.join(options.delimiter);
    var prefix = options.addQueryPrefix === true ? '?' : '';

    if (options.charsetSentinel) {
        if (options.charset === 'iso-8859-1') {
            // encodeURIComponent('&#10003;'), the "numeric entity" representation of a checkmark
            prefix += 'utf8=%26%2310003%3B' + options.delimiter;
        } else {
            // encodeURIComponent('✓')
            prefix += 'utf8=%E2%9C%93' + options.delimiter;
        }
    }

    return joined.length > 0 ? prefix + joined : '';
};
