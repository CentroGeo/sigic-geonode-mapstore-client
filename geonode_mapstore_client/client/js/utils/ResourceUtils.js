/*
 * Copyright 2021, GeoSolutions Sas.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import uuid from 'uuid';
import url from 'url';
import { isEmpty, uniqBy, omit, orderBy, isString, isObject } from 'lodash';

import { isImageServerUrl } from '@mapstore/framework/utils/ArcGISUtils';
import { getConfigProp, convertFromLegacy, normalizeConfig } from '@mapstore/framework/utils/ConfigUtils';
import { excludeGoogleBackground, extractTileMatrixFromSources, ServerTypes } from '@mapstore/framework/utils/LayersUtils';

import { getGeoNodeLocalConfig, parseDevHostname } from '@js/utils/APIUtils';
import { ProcessTypes, ProcessStatus } from '@js/utils/ResourceServiceUtils';
import { determineResourceType } from '@js/utils/FileUtils';

/**
* @module utils/ResourceUtils
*/

function getExtentFromResource({ extent }) {
    if (isEmpty(extent?.coords)) {
        return null;
    }
    const [minx, miny, maxx, maxy] = extent.coords;

    // if the extent is greater than the max extent of the WGS84 return null
    const WGS84_MAX_EXTENT = [-180, -90, 180, 90];
    if (minx < WGS84_MAX_EXTENT[0] || miny < WGS84_MAX_EXTENT[1] || maxx > WGS84_MAX_EXTENT[2] || maxy > WGS84_MAX_EXTENT[3]) {
        return null;
    }
    const bbox = {
        crs: 'EPSG:4326',
        bounds: { minx, miny, maxx, maxy }
    };
    return bbox;
}

export const GXP_PTYPES = {
    'AUTO': 'gxp_wmscsource',
    'OWS': 'gxp_wmscsource',
    'WMS': 'gxp_wmscsource',
    'WFS': 'gxp_wmscsource',
    'WCS': 'gxp_wmscsource',
    'REST_MAP': 'gxp_arcrestsource',
    'REST_IMG': 'gxp_arcrestsource',
    'HGL': 'gxp_hglsource',
    'GN_WMS': 'gxp_geonodecataloguesource'
};

export const RESOURCE_MANAGEMENT_PROPERTIES = {
    'metadata_uploaded_preserve': {
        labelId: 'gnviewer.preserveUploadedMetadata',
        tooltipId: 'gnviewer.preserveUploadedMetadataTooltip',
        disabled: (perms = []) => !perms.includes('change_resourcebase')
    },
    'is_approved': {
        labelId: 'gnviewer.approveResource',
        tooltipId: 'gnviewer.approveResourceTooltip',
        disabled: (perms = []) => !perms.includes('approve_resourcebase')
    },
    'is_published': {
        labelId: 'gnviewer.publishResource',
        tooltipId: 'gnviewer.publishResourceTooltip',
        disabled: (perms = []) => !perms.includes('publish_resourcebase')
    },
    'featured': {
        labelId: 'gnviewer.featureResource',
        tooltipId: 'gnviewer.featureResourceTooltip',
        disabled: (perms = []) => !perms.includes('feature_resourcebase')
    },
    'advertised': {
        labelId: 'gnviewer.advertiseResource',
        tooltipId: 'gnviewer.advertiseResourceTooltip',
        disabled: (perms = []) => !perms.includes('change_resourcebase')
    }
};

export const TIME_SERIES_PROPERTIES = ['attribute', 'end_attribute', 'presentation', 'precision_value', 'precision_step'];

export const TIME_ATTRIBUTE_TYPES = ['xsd:date', 'xsd:dateTime', 'xsd:date-time', 'xsd:time'];

export const TIME_PRECISION_STEPS = ['years', 'months', 'days', 'hours', 'minutes', 'seconds'];

export const isDefaultDatasetSubtype = (subtype) => !subtype || ['vector', 'raster', 'remote', 'vector_time'].includes(subtype);

export const FEATURE_INFO_FORMAT = 'TEMPLATE';

export const SOURCE_TYPES = {
    LOCAL: 'LOCAL',
    REMOTE: 'REMOTE'
};

const datasetAttributeSetToFields = ({ attribute_set: attributeSet = [] }) => {
    return attributeSet
        .filter(({ attribute_type: type }) => !type.includes('gml:'))
        .map(({
            attribute,
            attribute_label: alias,
            attribute_type: type
        }) => {
            return {
                name: attribute,
                alias: alias,
                type: type
            };
        });
};

export const getDimensions = ({links, has_time: hasTime} = {}) => {
    const { url: wmsUrl } = links?.find(({ link_type: linkType }) => linkType === 'OGC:WMS') || {};
    const { url: wmtsUrl } = links?.find(({ link_type: linkType }) => linkType === 'OGC:WMTS') || {};
    const dimensions = [
        ...(hasTime ? [{
            name: 'time',
            source: {
                type: 'multidim-extension',
                url: wmtsUrl || (wmsUrl || '').split('/geoserver/')[0] + '/geoserver/gwc/service/wmts'
            }
        }] : [])
    ];
    return dimensions;
};

/**
* convert resource layer configuration to a mapstore layer object
* @param {object} resource geonode layer resource
* @return {object}
*/
export const resourceToLayerConfig = (resource) => {

    const {
        alternate,
        links = [],
        featureinfo_custom_template: template,
        title,
        perms,
        pk,
        default_style: defaultStyle,
        ptype,
        subtype,
        sourcetype,
        data: layerSettings
    } = resource;

    const bbox = getExtentFromResource(resource);
    const defaultStyleParams = defaultStyle && {
        defaultStyle: {
            title: defaultStyle.sld_title,
            name: defaultStyle.workspace ? `${defaultStyle.workspace}:${defaultStyle.name}` : defaultStyle.name
        }
    };

    const extendedParams = {
        pk,
        mapLayer: {
            dataset: resource
        },
        ...defaultStyleParams
    };

    if (subtype === '3dtiles') {

        const { url: tilesetUrl } = links.find(({ extension }) => (extension === '3dtiles')) || {};

        return {
            id: uuid(),
            type: '3dtiles',
            title,
            url: parseDevHostname(tilesetUrl || ''),
            ...(bbox && { bbox }),
            visibility: true,
            extendedParams
        };
    }

    switch (ptype) {
    case GXP_PTYPES.REST_MAP:
    case GXP_PTYPES.REST_IMG: {
        const { url: arcgisUrl } = links.find(({ mime, link_type: linkType }) => (mime === 'text/html' && linkType === 'image')) || {};
        return {
            perms,
            id: uuid(),
            pk,
            type: 'arcgis',
            ...(isImageServerUrl(arcgisUrl)
                ? { queryable: false }
                : { name: alternate.replace('remoteWorkspace:', '') }),
            url: arcgisUrl,
            ...(bbox && { bbox }),
            title,
            visibility: true,
            extendedParams
        };
    }
    default:
        const { url: wfsUrl } = links.find(({ link_type: linkType }) => linkType === 'OGC:WFS') || {};
        const { url: wmsUrl } = links.find(({ link_type: linkType }) => linkType === 'OGC:WMS') || {};

        const dimensions = getDimensions(resource);

        const params = wmsUrl && url.parse(wmsUrl, true).query;
        const {
            defaultLayerFormat = 'image/png',
            defaultTileSize = 512
        } = getConfigProp('geoNodeSettings') || {};
        const fields = datasetAttributeSetToFields(resource);
        return {
            perms,
            id: uuid(),
            pk,
            type: 'wms',
            name: alternate,
            url: wmsUrl || '',
            format: defaultLayerFormat,
            ...(wfsUrl && {
                search: {
                    type: 'wfs',
                    url: wfsUrl
                }
            }),
            ...(bbox ? { bbox } : { bboxError: true }),
            ...(template && {
                featureInfo: {
                    format: FEATURE_INFO_FORMAT,
                    template
                }
            }),
            style: defaultStyleParams?.defaultStyle?.name || '',
            title,
            tileSize: defaultTileSize,
            visibility: true,
            ...(params && { params }),
            ...(dimensions.length > 0 && ({ dimensions })),
            extendedParams,
            ...(fields && { fields }),
            ...(sourcetype === SOURCE_TYPES.REMOTE && !wmsUrl.includes('/geoserver/') && {
                serverType: ServerTypes.NO_VENDOR
            }),
            ...layerSettings
        };
    }
};

function updateUrlQueryParameter(requestUrl = '', query) {
    const parsedUrl = url.parse(requestUrl, true);
    return url.format({
        ...parsedUrl,
        query: {
            ...parsedUrl.query,
            ...query
        }
    });
}

export function resourceToPermissionEntry(type, resource) {
    if (type === 'user') {
        return {
            type: 'user',
            id: resource.id || resource.pk,
            avatar: resource.avatar,
            name: resource.username,
            permissions: resource.permissions,
            parsed: true
        };
    }
    return {
        type: 'group',
        id: resource.id || resource?.group?.pk,
        name: resource.title,
        avatar: resource.logo,
        permissions: resource.permissions,
        parsed: true
    };
}

export function permissionsListsToCompact({ groups, entries }) {
    return {
        groups: groups
            .filter(({ permissions }) => permissions)
            .map(({ type, ...properties }) => (properties)),
        organizations: entries
            .filter(({ permissions, type }) => permissions && type === 'group')
            .map(({ type, ...properties }) => (properties)),
        users: entries
            .filter(({ permissions, type }) => permissions && type === 'user')
            .map(({ type, ...properties }) => (properties))
    };
}

export function permissionsCompactToLists({ groups, users, organizations }) {
    return {
        groups: [
            ...(groups || []).map((entry) => ({ ...entry, type: 'group', ...(!entry.parsed && { name: entry.name, avatar: entry.logo }) }))
        ],
        entries: [
            ...(users || []).map((entry) => ({ ...entry, type: 'user', ...(!entry.parsed && { name: entry.username, avatar: entry.avatar }) })),
            ...(organizations || []).map((entry) => ({ ...entry, type: 'group', ...(!entry.parsed && { name: entry.title, avatar: entry.logo }) }))
        ]
    };
}

export function cleanCompactPermissions({ groups, users, organizations }) {
    return {
        groups: groups
            .map(({ id, permissions }) => ({ id, permissions }))
            .sort((a, b) => a.id > b.id ? -1 : 1),
        organizations: organizations
            .map(({ id, permissions }) => ({ id, permissions }))
            .sort((a, b) => a.id > b.id ? -1 : 1),
        users: users
            .map(({ id, permissions }) => ({ id, permissions }))
            .sort((a, b) => a.id > b.id ? -1 : 1)
    };
}

export function getGeoLimitsFromCompactPermissions({ groups = [], users = [], organizations = [] }) {
    const entries = [
        ...users
            .filter(({ isGeoLimitsChanged }) => isGeoLimitsChanged)
            .map(({ id, features }) => ({ id, features, type: 'user' })),
        ...[...groups, ...organizations]
            .filter(({ isGeoLimitsChanged }) => isGeoLimitsChanged)
            .map(({ id, features }) => ({ id, features, type: 'group' }))
    ];
    return entries;
}

export const resourceHasPermission = (resource, perm) => {
    return resource?.perms?.includes(perm);
};


export const ResourceTypes = {
    DATASET: 'dataset',
    MAP: 'map',
    DOCUMENT: 'document',
    GEOSTORY: 'geostory',
    DASHBOARD: 'dashboard',
    VIEWER: 'mapviewer'
};

export const isDocumentExternalSource = (resource) => {
    return resource && resource.resource_type === ResourceTypes.DOCUMENT && resource.sourcetype === SOURCE_TYPES.REMOTE;
};

export const getResourceTypesInfo = () => ({
    [ResourceTypes.DATASET]: {
        icon: { glyph: 'dataset' },
        canPreviewed: (resource) => resourceHasPermission(resource, 'view_resourcebase'),
        formatEmbedUrl: (resource) => resource.embed_url && parseDevHostname(updateUrlQueryParameter(resource.embed_url, {
            config: 'dataset_preview'
        })),
        formatDetailUrl: (resource) => resource?.detail_url && parseDevHostname(resource.detail_url),
        name: 'Dataset',
        formatMetadataUrl: (resource) => `#/metadata/${resource.pk}`,
        formatMetadataDetailUrl: (resource) => `/metadata/${resource.pk}`
    },
    [ResourceTypes.MAP]: {
        icon: { glyph: '1-map', type: 'glyphicon' },
        name: 'Map',
        canPreviewed: (resource) => resourceHasPermission(resource, 'view_resourcebase'),
        formatEmbedUrl: (resource) => parseDevHostname(updateUrlQueryParameter(resource.embed_url, {
            config: 'map_preview'
        })),
        formatDetailUrl: (resource) => resource?.detail_url && parseDevHostname(resource.detail_url),
        formatMetadataUrl: (resource) => `#/metadata/${resource.pk}`,
        formatMetadataDetailUrl: (resource) => `/metadata/${resource.pk}`
    },
    [ResourceTypes.DOCUMENT]: {
        icon: { glyph: 'document' },
        name: 'Document',
        canPreviewed: (resource) => resourceHasPermission(resource, 'download_resourcebase') && !!(determineResourceType(resource.extension) !== 'unsupported'),
        hasPermission: (resource) => resourceHasPermission(resource, 'download_resourcebase'),
        formatEmbedUrl: (resource) => isDocumentExternalSource(resource) ? undefined : resource?.embed_url && parseDevHostname(resource.embed_url),
        formatDetailUrl: (resource) => resource?.detail_url && parseDevHostname(resource.detail_url),
        formatMetadataUrl: (resource) => `#/metadata/${resource.pk}`,
        formatMetadataDetailUrl: (resource) => `/metadata/${resource.pk}`,
        metadataPreviewUrl: (resource) => `/metadata/${resource.pk}/embed`
    },
    [ResourceTypes.GEOSTORY]: {
        icon: { glyph: 'geostory' },
        name: 'GeoStory',
        canPreviewed: (resource) => resourceHasPermission(resource, 'view_resourcebase'),
        formatEmbedUrl: (resource) => resource?.embed_url && parseDevHostname(resource.embed_url),
        formatDetailUrl: (resource) => resource?.detail_url && parseDevHostname(resource.detail_url),
        formatMetadataUrl: (resource) => `#/metadata/${resource.pk}`,
        formatMetadataDetailUrl: (resource) => `/metadata/${resource.pk}`
    },
    [ResourceTypes.DASHBOARD]: {
        icon: { glyph: 'dashboard' },
        name: 'Dashboard',
        canPreviewed: (resource) => resourceHasPermission(resource, 'view_resourcebase'),
        formatEmbedUrl: (resource) => resource?.embed_url && parseDevHostname(resource.embed_url),
        formatDetailUrl: (resource) => resource?.detail_url && parseDevHostname(resource.detail_url),
        formatMetadataUrl: (resource) => `#/metadata/${resource.pk}`,
        formatMetadataDetailUrl: (resource) => `/metadata/${resource.pk}`
    },
    [ResourceTypes.VIEWER]: {
        icon: { glyph: 'context' },
        name: 'MapViewer',
        canPreviewed: (resource) => resourceHasPermission(resource, 'view_resourcebase'),
        formatEmbedUrl: () => false,
        formatDetailUrl: (resource) => resource?.detail_url && parseDevHostname(resource.detail_url),
        formatMetadataUrl: (resource) => `#/metadata/${resource.pk}`,
        formatMetadataDetailUrl: (resource) => `/metadata/${resource.pk}`
    }
});

export const getMetadataUrl = (resource) => {
    if (resource) {
        const { formatMetadataUrl = () => '' } = getResourceTypesInfo()[resource?.resource_type] || {};
        return formatMetadataUrl(resource);
    }
    return '';
};

export const getMetadataDetailUrl = (resource) => {
    if (resource) {
        const { formatMetadataDetailUrl = () => '' } = getResourceTypesInfo()[resource?.resource_type] || {};
        return formatMetadataDetailUrl(resource);
    }
    return '';
};

export const getResourceStatuses = (resource, userInfo) => {
    const { executions = [] } = resource || {};
    const isApproved = resource?.is_approved;
    const isPublished = isApproved && resource?.is_published;
    const runningExecutions = executions.filter(({ func_name: funcName, status, user }) =>
        [ProcessStatus.RUNNING, ProcessStatus.READY].includes(status)
        && ['delete', 'copy', ProcessTypes.DELETE_RESOURCE, ProcessTypes.COPY_RESOURCE].includes(funcName)
        && (user === undefined || user === userInfo?.info?.preferred_username));
    const isProcessing = !!runningExecutions.length;
    const isDeleting = runningExecutions.some(({ func_name: funcName }) => ['delete', ProcessTypes.DELETE_RESOURCE].includes(funcName));
    const isCopying = runningExecutions.some(({ func_name: funcName }) => ['copy', ProcessTypes.COPY_RESOURCE].includes(funcName));
    return {
        isApproved,
        isPublished,
        isProcessing,
        isDeleting,
        isCopying,
        items: [
            ...(resource.advertised === false ? [{
                type: 'icon',
                tooltipId: 'resourcesCatalog.unadvertised',
                glyph: 'eye-slash'
            }] : []),
            ...(isDeleting ? [{
                type: 'text',
                labelId: 'gnviewer.deleting',
                variant: 'danger'
            }] : []),
            ...(isCopying ? [{
                type: 'text',
                labelId: 'gnviewer.cloning',
                variant: 'primary'
            }] : [])
        ]
    };
};


export let availableResourceTypes; // resource types utils to be imported intoby @js/api/geonode/v2, Share plugin and anywhere else needed
/**
 * A setter funtion to assign a value to availableResourceTypes
 * @param {*} value Value to be assign to availableResourceTypes (gotten from resource_types response payload)
 */
export const setAvailableResourceTypes = (value) => {
    availableResourceTypes = value;
};

/**
 * Extracts lists of permissions into an object for use in the Share plugin select elements
 * @param {Object} options Permission Object to extract permissions from
 * @returns An object containing permissions for each type of user/group
 */
export const getResourcePermissions = (options) => {
    const permissionsOptions = {};
    Object.keys(options).forEach((key) => {
        const permissions = options[key];
        let selectOptions = [];
        for (let indx = 0; indx < permissions.length; indx++) {
            const permission = permissions[indx].name || permissions[indx];
            const label = permissions[indx].label;
            if (permission !== 'owner') {
                selectOptions.push({
                    value: permission,
                    labelId: `gnviewer.${permission}Permission`,
                    label
                });
            }
        }
        permissionsOptions[key] = selectOptions;
    });

    return permissionsOptions;
};

export function parseStyleName({ workspace, name }) {
    const nameParts = name.split(':');
    if (nameParts.length > 1) {
        return name;
    }
    if (isString(workspace)) {
        return `${workspace}:${name}`;
    }
    if (isObject(workspace) && workspace?.name !== undefined) {
        return `${workspace.name}:${name}`;
    }
    return name;
}

export function cleanStyles(styles = [], excluded = []) {
    return uniqBy(styles
        .map(({ name, sld_title: sldTitle, title, workspace, metadata, format, canEdit }) => ({
            name: parseStyleName({ workspace, name }),
            title: sldTitle || title || name,
            metadata,
            format,
            canEdit
        })), 'name')
        .filter(({ name }) => !excluded.includes(name));
}

export function getGeoNodeMapLayers(data) {
    return (data?.map?.layers || [])
        .filter(layer => layer?.extendedParams?.mapLayer)
        .map((layer, index) => {
            return {
                ...(layer?.extendedParams?.mapLayer && {
                    pk: layer.extendedParams.mapLayer.pk
                }),
                current_style: layer.style || '',
                extra_params: {
                    msId: layer.id
                },
                ...(layer.type === 'wms' && { current_style: layer.style || '' }),
                name: layer.name || '',
                order: index,
                opacity: layer.opacity ?? 1,
                visibility: layer.visibility
            };
        });
}

export function toGeoNodeMapConfig(data) {
    if (!data) {
        return {};
    }
    const maplayers = getGeoNodeMapLayers(data);
    return {
        maplayers
    };
}

export function compareBackgroundLayers(aLayer, bLayer) {
    return aLayer.type === bLayer.type
        && aLayer.name === bLayer.name
        && aLayer.source === bLayer.source
        && aLayer.provider === bLayer.provider
        && aLayer.url === bLayer.url;
}

export function toMapStoreMapConfig(resource, baseConfig) {
    const { maplayers = [], data } = resource || {};
    const baseMapBackgroundLayers = (baseConfig?.map?.layers || []).filter(layer => layer.group === 'background');
    const currentBackgroundLayer = (data?.map?.layers || [])
        .filter(layer => layer.group === 'background')
        .find(layer => layer.visibility && baseMapBackgroundLayers.find(bLayer => compareBackgroundLayers(layer, bLayer)));

    const backgroundLayers = !currentBackgroundLayer
        ? baseMapBackgroundLayers
        : baseMapBackgroundLayers.map((layer) => ({
            ...layer,
            visibility: compareBackgroundLayers(layer, currentBackgroundLayer)
        }));

    const layers = (data?.map?.layers || [])
        .filter(layer => layer.group !== 'background')
        .map((layer) => {
            const mapLayer = maplayers.find(mLayer => layer.id !== undefined && mLayer?.extra_params?.msId === layer.id);
            if (mapLayer) {
                return {
                    ...layer,
                    ...(layer.type === 'wms' && {
                        style: mapLayer.current_style || layer.style || ''
                    }),
                    extendedParams: {
                        ...layer.extendedParams,
                        mapLayer
                    }
                };
            }
            if (!mapLayer && layer?.extendedParams?.mapLayer) {
                return null;
            }
            return layer;
        })
        .filter(layer => layer);

    // add all the map layers not included in the blob
    const addMapLayers = maplayers
        .filter(mLayer => mLayer?.dataset)
        .filter(mLayer => !layers.find(layer => layer.id !== undefined && mLayer?.extra_params?.msId === layer.id))
        .map(mLayer => resourceToLayerConfig(mLayer?.dataset));

    return {
        ...data,
        map: {
            ...data?.map,
            layers: [
                ...backgroundLayers,
                ...layers,
                ...addMapLayers
            ],
            sources: {
                ...data?.map?.sources,
                ...baseConfig?.map?.sources
            }
        }
    };
}

/**
 * Parse document response object (for image and video)
 * @param {Object} docResponse api response object
 * @param {Object} resource optional resource object
 * @returns {Object} new document config object
 */
export const parseDocumentConfig = (docResponse, resource = {}) => {

    return {
        thumbnail: docResponse.thumbnail_url,
        src: docResponse.href,
        title: docResponse.title,
        description: docResponse.raw_abstract,
        credits: docResponse.attribution,
        sourceId: docResponse.sourceId || 'geonode',
        ...((docResponse.subtype || docResponse.type) === 'image' &&
            { alt: docResponse.alternate, src: docResponse.href, ...(resource?.imgHeight && { imgHeight: resource?.imgHeight, imgWidth: resource?.imgWidth }) })
    };
};

/**
 * Parse map response object
 * @param {Object} mapResponse api response object
 * @param {Object} resource optional resource object
 * @returns {Object} new map config object
 */
export const parseMapConfig = (mapResponse, resource = {}) => {

    const { data, pk: id } = mapResponse;
    const config = data;
    const mapState = !config.version
        ? convertFromLegacy(config)
        : normalizeConfig(config.map);

    const layers = excludeGoogleBackground(mapState.layers.map(layer => {
        if (layer.group === 'background' && (layer.type === 'ol' || layer.type === 'OpenLayers.Layer')) {
            layer.type = 'empty';
        }
        return layer;
    }));

    const map = {
        ...(mapState && mapState.map || {}),
        id,
        sourceId: resource?.data?.sourceId || 'geonode',
        groups: mapState && mapState.groups || [],
        layers: mapState?.map?.sources
            ? layers.map(layer => {
                const tileMatrix = extractTileMatrixFromSources(mapState.map.sources, layer);
                return { ...layer, ...tileMatrix };
            })
            : layers
    };

    return {
        ...map,
        id,
        owner: mapResponse?.owner?.username,
        canCopy: true,
        canDelete: true,
        canEdit: true,
        name: resource?.data?.title || mapResponse?.title,
        description: resource?.data?.description || mapResponse?.abstract,
        thumbnail: resource?.data?.thumbnail || mapResponse?.thumbnail_url,
        type: 'map'
    };
};

/*
* Util to check if resource can be cloned (Save As)
* Requirements for copying are 'add_resource' permission and is_copyable property on resource
* the dataset and document need also the download_resourcebase permission
*/
export const canCopyResource = (resource, user) => {
    const canAdd = user?.perms?.includes('add_resource');
    const canCopy = resource?.is_copyable;
    const resourceType = resource?.resource_type;
    if ([ResourceTypes.DATASET, ResourceTypes.DOCUMENT].includes(resourceType)) {
        const canDownload = !!resource?.perms?.includes('download_resourcebase');
        return (canAdd && canCopy && canDownload) ? true : false;
    }
    return (canAdd && canCopy) ? true : false;
};

export const parseUploadResponse = (upload) => {
    return orderBy(uniqBy([...upload], 'id'), 'create_date', 'desc');
};

export const processUploadResponse = (response) => {
    const newResponse = response.reduce((acc, currentResponse) => {
        const duplicate = acc.find((upload) => {
            if (upload.id && currentResponse.id) {
                return upload.id === currentResponse.id;
            } else if (upload.id && currentResponse.exec_id) {
                return upload.id === currentResponse.exec_id;
            } else if (upload.exec_id && currentResponse.id) {
                return upload.exec_id === currentResponse.id;
            }
            return upload.exec_id === currentResponse.exec_id;
        });
        if (duplicate) {
            const newAcc = acc.filter((upload) => {
                if (upload.id && currentResponse.id) {
                    return upload.id !== currentResponse.id;
                } else if (upload.id && currentResponse.exec_id) {
                    return upload.id !== currentResponse.exec_id;
                } else if (upload.exec_id && currentResponse.id) {
                    return upload.exec_id !== currentResponse.id;
                }
                return upload.exec_id !== currentResponse.exec_id;
            });
            return [{...currentResponse, ...(!currentResponse.id && {create_date: currentResponse.created, id: currentResponse.exec_id})}, ...newAcc];
        }
        return [{...currentResponse, ...(!currentResponse.id && {create_date: currentResponse.created, id: currentResponse.exec_id})}, ...acc];
    }, []);

    const uploads = parseUploadResponse(newResponse);

    return uploads;
};

export const cleanUrl = (targetUrl) => {
    const {
        search,
        ...params
    } = url.parse(targetUrl);
    const hash = params.hash && `#${cleanUrl(params.hash.replace('#', ''))}`;
    return url.format({
        ...params,
        ...(hash && { hash })
    });
};

export const getResourceImageSource = (image) => {
    return image ? image : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAADICAIAAABZHvsFAAAACXBIWXMAAC4jAAAuIwF4pT92AAABiklEQVR42u3SAQ0AAAjDMMC/5+MAAaSVsKyTFHwxEmBoMDQYGgyNocHQYGgwNBgaQ4OhwdBgaDA0hgZDg6HB0GBoDA2GBkODocHQGBoMDYYGQ4OhMTQYGgwNhgZDY2gwNBgaDI2hwdBgaDA0GBpDg6HB0GBoMDSGBkODocHQYGgMDYYGQ4OhwdAYGgwNhgZDg6ExNBgaDA2GBkNjaDA0GBoMDYbG0GBoMDQYGkODocHQYGgwNIYGQ4OhwdBgaAwNhgZDg6HB0BgaDA2GBkODoTE0GBoMDYYGQ2NoMDQYGgwNhsbQYGgwNBgaQ4OhwdBgaDA0hgZDg6HB0GBoDA2GBkODocHQGBoMDYYGQ4OhMTQYGgwNhgZDY2gwNBgaDA2GxtBgaDA0GBoMjaHB0GBoMDSGBkODocHQYGgMDYYGQ4OhwdAYGgwNhgZDg6ExNBgaDA2GBkNjaDA0GBoMDYbG0GBoMDQYGgyNocHQYGgwNIYGQ4OhwdBgaAwNhgZDg6HB0BgaDA2GBkPDbQH4OQSN0W8qegAAAABJRU5ErkJggg==';
};

export const getDownloadUrlInfo = (resource) => {
    const hrefUrl = { url: resource?.href, ajaxSafe: false };
    if (isDocumentExternalSource(resource)) {
        return hrefUrl;
    }
    if (!isEmpty(resource?.download_urls)) {
        const downloadData = resource.download_urls.length === 1
            ? resource.download_urls[0]
            : resource.download_urls.find((d) => d.default);
        if (!isEmpty(downloadData)) {
            return { url: downloadData.url, ajaxSafe: downloadData.ajax_safe };
        }
    }
    return hrefUrl;
};

export const formatResourceLinkUrl = (resource) => {
    let href = window.location.href;
    if (resource?.uuid) {
        href = href.replace(/#.+$/, `uuid/${resource.uuid}`);
    }
    return cleanUrl(href);
};

export const getCataloguePath = (path = '') => {
    const catalogPagePath = getGeoNodeLocalConfig('geoNodeSettings.catalogPagePath');
    if (!isEmpty(catalogPagePath)) {
        return path.replace('/catalogue/', catalogPagePath);
    }
    return path;
};

export const getResourceWithLinkedResources = (resource = {}) => {
    let linkedResources = resource.linked_resources ?? {};
    if (!isEmpty(linkedResources)) {
        const linkedTo = linkedResources.linked_to ?? [];
        const linkedBy = linkedResources.linked_by ?? [];
        linkedResources = isEmpty(linkedTo) && isEmpty(linkedBy) ? {} : ({ linkedTo, linkedBy });
        return { ...omit(resource, 'linked_resources'), linkedResources };
    }
    return resource;
};

export const getResourceAdditionalProperties = (_resource = {}) => {
    const resource =  getResourceWithLinkedResources(_resource);
    const links = resource?.links || [];
    const assets = links.filter(link => link?.extras?.type === 'asset' && link?.extras?.content?.title);
    return {
        ...resource,
        ...(assets?.length && { assets })
    };
};

export const parseCatalogResource = (resource) => {
    const {
        formatDetailUrl,
        icon,
        formatEmbedUrl,
        canPreviewed,
        hasPermission,
        name
    } = getResourceTypesInfo(resource)[resource.resource_type];
    const resourceCanPreviewed = resource?.pk && canPreviewed && canPreviewed(resource);
    const embedUrl = resourceCanPreviewed && formatEmbedUrl && resource?.embed_url && formatEmbedUrl(resource);
    const canView = resource?.pk && hasPermission && hasPermission(resource);
    const viewerUrl = formatDetailUrl(resource);
    const viewerUrlParts = (viewerUrl || '').split('#');
    const viewerPath = viewerUrlParts[viewerUrlParts.length - 1];
    const metadataDetailUrl = resource?.pk && getMetadataDetailUrl(resource);
    return {
        ...resource,
        id: resource.pk,
        name: resource.title,
        '@extras': {
            info: {
                title: resource?.title,
                icon,
                thumbnailUrl: resource?.thumbnail_url,
                ...((canView || resourceCanPreviewed) && {
                    viewerPath: viewerPath,
                    viewerUrl: viewerUrl
                }),
                embedUrl,
                metadataDetailUrl,
                typeName: name
            },
            status: getResourceStatuses(resource)
        }
    };
};

export const resourceToLayers = (resource) => {
    if (resource?.resource_type === ResourceTypes.DATASET) {
        return [{...resourceToLayerConfig(resource), isDataset: true}];
    }
    if (resource.maplayers && resource?.resource_type === ResourceTypes.MAP) {
        return resource.maplayers
            .map(maplayer => {
                maplayer.dataset ? resourceToLayerConfig(maplayer.dataset) : null;
                if (maplayer.dataset) {
                    const layer = resourceToLayerConfig(maplayer.dataset);
                    return {
                        ...layer,
                        style: maplayer.current_style
                    };
                }
                return null;
            })
            .filter(value => value);
    }
    return [];
};

export const canManageResourceSettings = (resource) => {
    const { perms } = resource || {};
    const settingsPerms = ['feature_resourcebase', 'approve_resourcebase', 'publish_resourcebase'];
    return !!(perms || []).find(perm => settingsPerms.includes(perm));
};

export const canAccessPermissions = (resource) => {
    const { perms } = resource || {};
    return perms?.includes('change_resourcebase_permissions');
};
