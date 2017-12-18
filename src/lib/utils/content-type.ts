import * as fileType from 'file-type';
import * as isSvg from 'is-svg';
import * as mimeDB from 'mime-db';
import { parse, MediaType } from 'content-type';

import { debug as d } from './debug';
import { IAsyncHTMLElement, IResponse } from '../types';
import { getFileExtension, normalizeString } from './misc';

const debug = d(__filename);

/*
 * ---------------------------------------------------------------------
 * Private methods
 * ---------------------------------------------------------------------
 */

const getMediaTypeBasedOnFileExtension = (fileExtension: string): string => {
    return fileExtension && Object.keys(mimeDB).find((key) => {
        return mimeDB[key].extensions && mimeDB[key].extensions.includes(fileExtension);
    });
};

const determineCharset = (originalCharset: string, mediaType: string): string => {

    /*
     * Prior to HTML5, for web pages, `ISO-8859-1` was the
     * default charset:
     *
     * " For example, user agents typically assume that
     *   in the absence of other indicators, the character
     *   encoding is ISO-8859-1. "
     *
     * From: https://www.w3.org/TR/WD-html40-970708/html40.txt
     *
     * However, `ISO-8859-1` is not supported by node directly.
     * https://github.com/sonarwhal/sonarwhal/issues/89
     */

    const charsetAliases: Map<string, string> = new Map([
        ['iso-8859-1', 'latin1']
    ]);

    const defaultCharset = charsetAliases.get(originalCharset) || originalCharset;

    // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

    const typeInfo = mimeDB[mediaType];
    let determinedCharset = typeInfo && normalizeString(typeInfo.charset);

    if (defaultCharset && (determinedCharset === defaultCharset)) {
        return defaultCharset;
    }

    /*
     * If the determined charset is different from what the server
     * provided, try to figure out which one should be used.
     */

    /*
     * Check if (according to the determined media type) the
     * document is a binary file, and if it is, ignore the charset.
     */

    if (!isTextMediaType(mediaType)) { // eslint-disable-line no-use-before-define, typescript/no-use-before-define
        return null;
    }

    /*
     * If it's a text based document, and the charset could
     * not be determined, default to `utf-8`.
     */

    determinedCharset = determinedCharset || 'utf-8';

    /*
     * If the charset was not specified, use the determined
     * one, otherwise, go with the specified one even though
     * it might not be the best charset (e.g.: `ISO-8859-1`
     * vs. `utf-8`).
     *
     * Notes:
     *
     *  * Not going with the specified charset when there is one
     *    might make some of our rule not detect some problems.
     *
     *  * The `content-type` role is responsable for suggesting
     *    the correct/best charset.
     */

    return defaultCharset ? defaultCharset : determinedCharset;
};

const determineMediaTypeForScript = (element: IAsyncHTMLElement): string => {
    const typeAttribute = normalizeString(element.getAttribute('type'));

    /*
     * Valid JavaScript media types:
     * https://html.spec.whatwg.org/multipage/scripting.html#javascript-mime-type
     */

    const validJavaScriptMediaTypes = [
        'application/ecmascript',
        'application/javascript',
        'application/x-ecmascript',
        'application/x-javascript',
        'text/ecmascript',
        'text/javascript',
        'text/javascript1.0',
        'text/javascript1.1',
        'text/javascript1.2',
        'text/javascript1.3',
        'text/javascript1.4',
        'text/javascript1.5',
        'text/jscript',
        'text/livescript',
        'text/x-ecmascript',
        'text/x-javascript'
    ];

    /*
     * If the type attribute is:
     *
     *  * omitted (doesn't have a value, or is an empty string)
     *  * set to one of the valid JavaScript media types
     *  * 'module'
     *
     * it means the content is not intended as an data block,
     * and the official JavaScript media type can be suggested.
     *
     * See: https://html.spec.whatwg.org/multipage/scripting.html#attr-script-type
     */

    if (!typeAttribute ||
        validJavaScriptMediaTypes.includes(typeAttribute) ||
        typeAttribute === 'module') {

        /*
         * From https://html.spec.whatwg.org/multipage/scripting.html#scriptingLanguages
         *
         * " Servers should use `text/javascript` for JavaScript
         *   resources. Servers should not use other JavaScript
         *   MIME types for JavaScript resources, and must not
         *   use non-JavaScript MIME types. "
         */

        return 'text/javascript';
    }

    return null;
};

const determineMediaTypeBasedOnElement = (element: IAsyncHTMLElement): string => {
    const nodeName = element && normalizeString(element.nodeName);

    if (nodeName) {

        if (nodeName === 'script') {
            return determineMediaTypeForScript(element);
        }

        if (nodeName === 'link') {
            const relValue = element.getAttribute('rel');

            /* eslint-disable default-case */
            switch (relValue) {
                case 'stylesheet':
                    // See: https://tools.ietf.org/html/rfc2318.
                    return 'text/css';
                case 'manifest':
                    // See: https://w3c.github.io/manifest/#media-type-registration.
                    return 'application/manifest+json';
            }
            /* eslint-enable no-default */
        }
    }

    return null;
};

const determineMediaTypeBasedOnFileExtension = (resource: string): string => {
    const fileExtension = getFileExtension(resource);

    if (!fileExtension) {
        return null;
    }

    /*
     * The following list is order based on the expected encounter
     * rate and different statistics (e.g. for images, except `ico`,
     * http://httparchive.org/interesting.php#imageformats)
     */

    /*
     * The reasons for hard-coding some of the values here are:
     *
     *  * `mime-db` is quite big, so querying it is expensive.
     *  * `mime-db` sometimes has multiple media types for
     *     the same file type (e.g.: for `js` the result will be
     *     "application/javascript" instead of what this project
     *     recommends, namely `text/javascript`).
     *
     * See also: http://www.iana.org/assignments/media-types/media-types.xhtml
     */

    /* eslint-disable default-case */
    switch (fileExtension) {
        case 'html':
        case 'htm':
            return 'text/html';
        case 'xhtml':
            return 'application/xhtml+xml';
        case 'js':
            return 'text/javascript';
        case 'css':
            return 'text/css';
        case 'ico':
            return 'image/x-icon';
        case 'webmanifest':
            // See: https://w3c.github.io/manifest/#media-type-registration.
            return 'application/manifest+json';
        case 'jpeg':
        case 'jpg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'gif':
            return 'image/gif';
        case 'svg':
            // See: https://www.w3.org/TR/SVG/mimereg.html.
            return 'image/svg+xml';
        case 'webp':
            return 'image/webp';
        case 'woff2':
            return 'font/woff2';
        case 'woff':
            return 'font/woff';
        case 'ttf':
            return 'font/ttf';
        case 'otf':
            return 'font/otf';
    }
    /* eslint-enable no-default */

    // If the file extension is not in the list above, query `mime-db`.

    return getMediaTypeBasedOnFileExtension(fileExtension);
};

const determineMediaTypeBasedOnFileType = (rawContent: Buffer): string => {
    const detectedFileType = fileType(rawContent);

    if (detectedFileType) {
        // Use the media types from `mime-db`, not `file-type`.
        return getMediaTypeBasedOnFileExtension(detectedFileType.ext);
    }

    if (rawContent && isSvg(rawContent)) {
        // See: https://www.w3.org/TR/SVG/mimereg.html.
        return 'image/svg+xml';
    }

    return null;
};

const parseContentTypeHeader = (response: IResponse): MediaType => {
    const contentTypeHeaderValue: string = normalizeString(response.headers ? response.headers['content-type'] : null);

    // Check if the `Content-Type` header was sent.

    if (contentTypeHeaderValue === null) {
        debug(`'content-type' header was not specified`);

        return null;
    }

    // Check if the `Content-Type` header was sent with a valid value.

    let contentType: MediaType;

    try {
        if (contentTypeHeaderValue === '') {
            throw new TypeError('invalid media type');
        }

        contentType = parse(contentTypeHeaderValue);
    } catch (e) {
        debug(`'content-type' header value is invalid (${e.message})`);

        return null;
    }

    return contentType;
};

/*
 * ---------------------------------------------------------------------
 * Public methods
 * ---------------------------------------------------------------------
 */

/*
 * Try to determine the media type and charset based on the response's
 * content-type header value, but also (because sometimes serers are
 * misconfigured) on things such as the file type, element type, and
 * file extension.
 */

const getContentTypeData = (element: IAsyncHTMLElement, resource: string, response: IResponse) => {

    let originalMediaType = null;
    let originalCharset = null;

    const contentType = parseContentTypeHeader(response);

    if (contentType) {
        originalCharset = contentType.parameters.charset;
        originalMediaType = contentType.type;
    }

    /*
     * Try to determine the media type and charset using
     * what the server specified, but also other available
     * information, as sometimes servers are misconfigured.
     */

    const mediaType =
        determineMediaTypeBasedOnElement(element) ||
        determineMediaTypeBasedOnFileType(response.body.rawContent) ||
        determineMediaTypeBasedOnFileExtension(resource) ||
        originalMediaType;

    const charset = determineCharset(originalCharset, mediaType);

    return {
        charset,
        mediaType
    };
};

/*
 * Check if a media type is one of a file type that is text based.
 */

const isTextMediaType = (mediaType: string): boolean => {
    const textMediaTypes: Array<RegExp> = [
        /application\/(?:javascript|json|x-javascript|xml)/i,
        /application\/.*\+(?:json|xml)/i,
        /image\/svg\+xml/i,
        /text\/.*/i
    ];

    if (textMediaTypes.some((regex) => {
        return regex.test(mediaType);
    })) {
        return true;
    }

    return false;
};

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

export {
    determineMediaTypeForScript,
    getContentTypeData,
    getFileExtension,
    isTextMediaType
};
