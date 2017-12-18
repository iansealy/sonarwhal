/**
 * @fileoverview Check the usage of the `Content-Type` HTTP response
 * header.
 */

/*
 * ------------------------------------------------------------------------------
 * Requirements
 * ------------------------------------------------------------------------------
 */

import { MediaType, parse } from 'content-type';

import { Category } from '../../enums/category';
import { debug as d } from '../../utils/debug';
import { IAsyncHTMLElement, IResponse, IRule, IRuleBuilder, IFetchEnd } from '../../types';
import { isDataURI, normalizeString } from '../../utils/misc';
import { isTextMediaType } from '../../utils/content-type';
import { RuleContext } from '../../rule-context';

const debug = d(__filename);

/*
 * ------------------------------------------------------------------------------
 * Public
 * ------------------------------------------------------------------------------
 */

const rule: IRuleBuilder = {
    create(context: RuleContext): IRule {

        let userDefinedMediaTypes;

        const loadRuleConfigs = () => {
            userDefinedMediaTypes = context.ruleOptions || {};
        };

        const getLastRegexThatMatches = (resource: string): string => {
            const results = (Object.entries(userDefinedMediaTypes).filter(([regex]) => {
                const re = new RegExp(regex, 'i');

                return re.test(resource);
            }))
                .pop();

            return results && results[1];
        };

        const validate = async (fetchEnd: IFetchEnd) => {
            const { element, resource, response }: { element: IAsyncHTMLElement, resource: string, response: IResponse } = fetchEnd;

            // This check does not make sense for data URIs.

            if (isDataURI(resource)) {
                debug(`Check does not apply for data URIs`);

                return;
            }

            const contentTypeHeaderValue: string = normalizeString(response.headers['content-type']);

            // Check if the `Content-Type` header was sent.

            if (contentTypeHeaderValue === null) {
                await context.report(resource, element, `'content-type' header was not specified`);

                return;
            }

            /*
             * If the current resource matches any of the regexes
             * defined by the user, use that value to validate.
             */

            const userDefinedMediaType: string = getLastRegexThatMatches(resource);

            if (userDefinedMediaType) {
                if (normalizeString(userDefinedMediaType) !== contentTypeHeaderValue) {
                    await context.report(resource, element, `'content-type' header should have the value '${userDefinedMediaType}'`);
                }

                return;
            }

            // Check if the `Content-Type` value is valid.

            let contentType: MediaType;

            try {
                if (contentTypeHeaderValue === '') {
                    throw new TypeError('invalid media type');
                }

                contentType = parse(contentTypeHeaderValue);
            } catch (e) {
                await context.report(resource, element, `'content-type' header value is invalid (${e.message})`);

                return;
            }

            const originalCharset: string = normalizeString(contentType.parameters.charset);
            const originalMediaType: string = contentType.type;

            /*
             * Determined values
             *
             * Notes:
             *
             *  * The connectors already did all the heavy lifting here.
             *  * For the charset, recommend `utf-8` for all text based
             *    bases documents.
             */

            const mediaType: string = response.mediaType;
            const charset: string = isTextMediaType(mediaType) ? 'utf-8' : response.charset;

            /*
             * Check if the determined values differ
             * from the ones from the `Content-Type` header.
             */

            // * media type

            if (mediaType && (mediaType !== originalMediaType)) {
                await context.report(resource, element, `'content-type' header should have media type '${mediaType}' (not '${originalMediaType}')`);
            }

            // * charset value

            if (charset) {
                if (!originalCharset || (charset !== originalCharset)) {
                    await context.report(resource, element, `'content-type' header should have 'charset=${charset}'${originalCharset ? ` (not '${originalCharset}')` : ''}`);
                }
            } else if (originalCharset && !['text/html', 'application/xhtml+xml'].includes(originalMediaType)) {
                await context.report(resource, element, `'content-type' header should not have 'charset=${originalCharset}'`);
            }
        };

        loadRuleConfigs();

        return {
            'fetch::end': validate,
            'manifestfetch::end': validate,
            'targetfetch::end': validate
        };
    },
    meta: {
        docs: {
            category: Category.interoperability,
            description: 'Require `Content-Type` header with appropriate value'
        },
        recommended: true,
        schema: [{
            items: { type: 'string' },
            type: ['object', null],
            uniqueItems: true
        }],
        worksWithLocalFiles: false
    }
};

export default rule;
