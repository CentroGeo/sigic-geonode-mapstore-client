/*
 * Copyright 2021, GeoSolutions Sas.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { connect } from 'react-redux';
import { createSelector } from 'reselect';
import isEmpty from 'lodash/isEmpty';
import { createPlugin } from '@mapstore/framework/utils/PluginsUtils';
import { getDownloadUrlInfo, isDocumentExternalSource, GXP_PTYPES, SOURCE_TYPES } from '@js/utils/ResourceUtils';
import Message from '@mapstore/framework/components/I18N/Message';
import Button from '@mapstore/framework/components/layout/Button';
import tooltip from '@mapstore/framework/components/misc/enhancers/tooltip';
import { MenuItem } from 'react-bootstrap';
import Icon from '@js/components/Icon';
import {
    getResourceData
} from '@js/selectors/resource';
import { downloadResource } from '@js/actions/gnresource';
import { processingDownload } from '@js/selectors/resourceservice';

const ButtonWithTooltip = tooltip(Button);

const RENDER_TYPE = {
    "button": ButtonWithTooltip,
    "menuItem": MenuItem
};

const DownloadButton = ({
    resource,
    resourceData,
    variant,
    size,
    onAction = () => {},
    renderType = "button",
    showIcon,
    downloadMsgId = "gnviewer.download",
    allowedSources = [SOURCE_TYPES.LOCAL, SOURCE_TYPES.REMOTE],
    downloading
}) => {
    const Component =  RENDER_TYPE[renderType];
    const isButton = renderType !== "menuItem";
    const _resource = resource ?? resourceData;
    const downloadInfo = getDownloadUrlInfo(_resource);
    const isExternal = isDocumentExternalSource(_resource);
    const isNotAjaxSafe = !Boolean(downloadInfo?.ajaxSafe);

    if ((isEmpty(_resource?.download_urls) && !_resource?.perms?.includes('download_resourcebase'))
        || !_resource?.perms?.includes('download_resourcebase')
        || (!isButton && isNotAjaxSafe)
        || [GXP_PTYPES.REST_MAP, GXP_PTYPES.REST_IMG].includes(_resource?.ptype) // exclude arcgis remote layers from direct download
        || !allowedSources.includes(_resource?.sourcetype)
    ) {
        return null;
    }

    if (isNotAjaxSafe) {
        return downloadInfo.url ? (
            <Component
                {...isButton && { variant, size }}
                {...showIcon && { tooltipId: downloadMsgId }}
                download
                href={ downloadInfo.url }
                target="_blank"
                rel="noopener noreferrer"
            >
                {showIcon
                    ? <Icon glyph={isExternal ? "external-link" : "download"} />
                    : <Message msgId={downloadMsgId} />
                }
            </Component>
        ) : null;
    }

    return (
        <Component
            disabled={!!downloading}
            onClick={() => downloading ? null : onAction(_resource)}
            {...isButton && { variant, size}}
            {...showIcon && { tooltipId: downloadMsgId }}
        >
            {showIcon
                ? <Icon glyph="download" />
                : <Message msgId={downloadMsgId} />
            }
        </Component>
    );
};

const DownloadResource = connect(
    createSelector([
        getResourceData,
        processingDownload
    ], (resourceData, downloading) => ({
        resourceData,
        downloading
    })),
    {
        onAction: downloadResource
    }
)(DownloadButton);

/**
* @module DownloadResource
*/

/**
 * enable button or menu item to download a specific resource
 * @name DownloadResource
 * @example
 * {
 *  "name": "DownloadResource"
 * }
 */
export default createPlugin('DownloadResource', {
    component: DownloadResource,
    containers: {
        ActionNavbar: {
            name: 'DownloadResource',
            Component: DownloadResource,
            priority: 1
        },
        ResourcesGrid: {
            name: 'downloadResource',
            target: 'cardOptions',
            detailsToolbar: true,
            Component: DownloadResource,
            priority: 1
        },
        ResourceDetails: {
            name: 'DownloadResource',
            target: 'toolbar',
            Component: DownloadResource,
            priority: 1,
            position: 1
        },
        LayerDownload: {
            name: 'DownloadResource',
            Component: DownloadResource,
            priority: 1
        }
    },
    epics: {},
    reducers: {}
});
