/** @scratch /panels/5
 *
 * include::panels/bettermap.asciidoc[]
 */

/** @scratch /panels/bettermap/0
 *
 * == Bettermap
 * Status: *Experimental*
 *
 * Bettermap is called bettermap for lack of a better name. Bettermap uses geographic coordinates to
 * create clusters of markers on map and shade them orange, yellow and green depending on the
 * density of the cluster.
 *
 * To drill down, click on a cluster. The map will be zoomed and the cluster broken into smaller cluster.
 * When it no longer makes visual sense to cluster, individual markers will be displayed. Hover over
 * a marker to see the tooltip value/
 *
 * IMPORTANT: bettermap requires an internet connection to download its map panels.
 */
define([
'angular', 
'app', 
'lodash', 
'./leaflet/leaflet-src', 
'require', 
'kbn', 

'css!./module.css', 
'css!./leaflet/leaflet.css', 
'css!./leaflet/leaflet-d3.css', 
'css!./leaflet/plugins.css'
], 
function(angular, app, _, L, localRequire, kbn) {
    'use strict';
    
    var module = angular.module('kibana.panels.bettermap', []);
    app.useModule(module);
    
    module.controller('bettermap', function($scope, querySrv, dashboard, filterSrv) {
        $scope.panelMeta = {
            editorTabs: [
            {
                title: 'Queries',
                src: 'app/partials/querySelect.html'
            }
            ],
            modals: [
            {
                description: "Inspect",
                icon: "icon-info-sign",
                partial: "app/partials/inspector.html",
                show: $scope.panel.spyable
            }
            ],
            status: "Experimental",
            description: "Displays geo points in clustered groups on a map. The caveat for this panel is" + 
            " that, for better or worse, it does NOT use the terms facet and it <b>does</b> query " + 
            "sequentially. This however means that it transfers more data and is generally heavier to" + 
            " compute, while showing less actual data. If you have a time filter, it will attempt to" + 
            " show to most recent points in your search, up to your defined limit."
        };
        
        // Set and populate defaults
        var _d = {
            /** @scratch /panels/bettermap/3
       *
       * === Parameters
       *
       * field:: The field that contains the coordinates, in geojson format. GeoJSON is
       * +[longitude,latitude]+ in an array. This is different from most implementations, which use
       * latitude, longitude.
       */
            field: null ,
            /** @scratch /panels/bettermap/5
       * size:: The number of documents to use when drawing the map
       */
            size: 1000,
            /** @scratch /panels/bettermap/5
       * spyable:: Should the `inspect` icon be shown?
       */
            spyable: true,
            /** @scratch /panels/bettermap/5
       * tooltip:: Which field to use for the tooltip when hovering over a marker
       */
            tooltip: "_id",
            /** @scratch /panels/bettermap/5
       *
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
            queries: {
                mode: 'all',
                ids: []
            },
        };
        
        _.defaults($scope.panel, _d);
        
        // inorder to use relative paths in require calls, require needs a context to run. Without
        // setting this property the paths would be relative to the app not this context/file.
        $scope.requireContext = localRequire;
        
        $scope.init = function() {
            $scope.$on('refresh', function() {
                $scope.get_data();
            }
            );
            $scope.get_data();
        }
        ;
        $scope.random = function(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        $scope.getMarkerSize = function(panel, value) {
            if ($scope.between(value, panel.cc.small_range_min, panel.cc.small_range_max)) {
                return 's';
            } else if ($scope.between(value, panel.cc.medium_range_min, panel.cc.medium_range_max)) {
                return 'm';
            } else if ($scope.between(value, panel.cc.large_range_min, panel.cc.large_range_max)) {
                return 'l';
            }
        }
        $scope.getMarkerColor = function(panel, value) {
            if ($scope.between(value, panel.cc.small_range_min, panel.cc.small_range_max)) {
                return panel.cc.small;
            } else if ($scope.between(value, panel.cc.medium_range_min, panel.cc.medium_range_max)) {
                return panel.cc.medium;
            } else if ($scope.between(value, panel.cc.large_range_min, panel.cc.large_range_max)) {
                return panel.cc.large;
            }
        }
        $scope.between = function(x, min, max) {
            return x >= min && x <= max;
        }
        $scope.setupMarkerColor = function(panel) {
            var element = document.querySelectorAll(".marker-cluster-s");
            var r, g, b;
            for (var i = 0; i < element.length; i++) {
                element[i].style.backgroundcolor = 'rgba(' + 255 + ',' + 0 + ',' + 0 + ',' + 0.6 + ')';
            }
        }
        $scope.hexToRgb = function(hex) {
            var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null ;
        }
        
        $scope.poll_for_data = function(segment_2, query_id_2) {
            $scope.require(['./leaflet/plugins'], function() {
                $scope.panel.error = false;
                var _segment_2 = _.isUndefined(segment_2) ? 0 : segment_2;
                
                $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
                var queries = querySrv.getQueryObjs($scope.panel.queries.ids);
                
                var boolQuery = $scope.ejs.BoolQuery();
                _.each(queries, function(q) {
                    boolQuery = boolQuery.should(querySrv.toEjsObj(q));
                }
                );
                
                var isPolled = $scope.panel.poll;
                if (!_.isUndefined(isPolled) && isPolled) {
                    var poll_duration = $scope.panel.poll_duration;
                    
                    var timeField = window.kibana.timefield;
                    
                    var poll_filter = getBoolFilterForPoll(poll_duration);
                    
                    function getBoolFilterForPoll(poll_duration) {
                        var bool = ejs.BoolFilter();
                        var filter = {
                            active: true,
                            alias: "",
                            field: timeField,
                            from: "now-" + poll_duration,
                            id: 0,
                            mandate: "must",
                            to: "now",
                            type: "time"
                        };
                        var _f = ejs.RangeFilter(filter.field).from(kbn.parseDate(filter.from).valueOf());
                        _f = _f.to(kbn.parseDate(filter.to).valueOf());
                        bool.must(_f);
                        return bool;
                    }
                    
                    var request = $scope.ejs.Request().indices(dashboard.indices[_segment_2])
                    .query($scope.ejs.FilteredQuery(
                    boolQuery, 
                    poll_filter
                    .must($scope.ejs.ExistsFilter($scope.panel.field))
                    ))
                    .fields($scope.panel.field)
                    .size($scope.panel.size);
                    if (!_.isNull(timeField)) {
                        request = request.sort(timeField, 'desc');
                    }
                    
                    var results = request.doSearch();
                    
                    // Populate scope when we have results
                    results.then(function(results) {
                        $scope.panelMeta.loading = false;
                        
                        if (_segment_2 === 0) {
                            $scope.hits = 0;
                            $scope.data = [];
                            query_id_2 = $scope.query_id_2 = new Date().getTime();
                        }
                        
                        // Check for error and abort if found
                        if (!(_.isUndefined(results.error))) {
                            $scope.panel.error = $scope.parse_error(results.error);
                            return;
                        }
                        
                        // Check that we're still on the same query, if not stop
                        if ($scope.query_id_2 === query_id_2) {
                            _.each(results.hits.hits, function(data) {
                                $scope.pingLayer.ping(data.fields.location);
                            }
                            );
                        } else {
                            return;
                        }
                        
                        // Get $size results then stop querying
                        if ($scope.data.length < $scope.panel.size && _segment_2 + 1 < dashboard.indices.length) {
                            $scope.poll_for_data(_segment_2 + 1, $scope.query_id_2);
                        }
                        
                        var poll_duration_in_milliseconds = getPollDurationInMilliSeconds(poll_duration);
                        
                        function getPollDurationInMilliSeconds(poll_duration) {
                            function endsWith(str, suffix) {
                                return str.indexOf(suffix, str.length - suffix.length) !== -1;
                            }
                            var valueInMilliSeconds = 2000;
                            if (endsWith(poll_duration, 's')) {
                                valueInMilliSeconds = poll_duration.slice(0, -1) * 1000;
                            } else if (endsWith(poll_duration, 'm')) {
                                valueInMilliSeconds = poll_duration.slice(0, -1) * 60 * 1000;
                            } else if (endsWith(poll_duration, 'h')) {
                                valueInMilliSeconds = poll_duration.slice(0, -1) * 60 * 60 * 1000;
                            } else if (endsWith(poll_duration, 'd')) {
                                valueInMilliSeconds = poll_duration.slice(0, -1) * 60 * 60 * 24 * 1000;
                            } else {
                            //Unsupported parameter - default to seconds
                            }
                            return valueInMilliSeconds;
                        }
                        
                        window.setTimeout(function() {
                            $scope.poll_for_data();
                        }
                        , $scope.random(2, 5) * 1000);
                        //poll_duration_in_milliseconds); // Remove during production
                    }
                    );
                }
            }
            );
        }
        ;
        
        $scope.get_data = function(segment, query_id) {
            $scope.require(['./leaflet/plugins'], function() {
                $scope.panel.error = false;
                
                // Make sure we have everything for the request to complete
                if (dashboard.indices.length === 0) {
                    return;
                }
                
                if (_.isUndefined($scope.panel.field)) {
                    $scope.panel.error = "Please select a field that contains geo point in [lon,lat] format";
                    return;
                }
                
                // Determine the field to sort on
                var timeField = _.uniq(_.pluck(filterSrv.getByType('time'), 'field'));
                if (timeField.length > 1) {
                    $scope.panel.error = "Time field must be consistent amongst time filters";
                } else if (timeField.length === 0) {
                    timeField = null ;
                } else {
                    timeField = timeField[0];
                }
                
                var _segment = _.isUndefined(segment) ? 0 : segment;
                
                $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
                var queries = querySrv.getQueryObjs($scope.panel.queries.ids);
                
                var boolQuery = $scope.ejs.BoolQuery();
                _.each(queries, function(q) {
                    boolQuery = boolQuery.should(querySrv.toEjsObj(q));
                }
                );
                
                var fieldsArray = [$scope.panel.field];
                var tooltipArray = $scope.panel.tooltip.split(',');
                for (var i = 0; i < tooltipArray.length; i++) {
                    tooltipArray[i] = tooltipArray[i].trim();
                }
                ;
                fieldsArray = fieldsArray.concat(tooltipArray);
                if (!_.isUndefined($scope.panel.parameter)) {
                    fieldsArray = fieldsArray.concat($scope.panel.parameter);
                }
                var request = $scope.ejs.Request().indices(dashboard.indices[_segment])
                .query($scope.ejs.FilteredQuery(
                boolQuery, 
                filterSrv.getBoolFilter(filterSrv.ids()).must($scope.ejs.ExistsFilter($scope.panel.field))
                ))
                .fields(fieldsArray)
                .size($scope.panel.size);
                
                if (!_.isNull(timeField)) {
                    request = request.sort(timeField, 'desc');
                }
                
                $scope.populate_modal(request);
                
                var results = request.doSearch();
                
                // Populate scope when we have results
                results.then(function(results) {
                    $scope.panelMeta.loading = false;
                    
                    if (_segment === 0) {
                        $scope.hits = 0;
                        $scope.data = [];
                        query_id = $scope.query_id = new Date().getTime();
                    }
                    
                    // Check for error and abort if found
                    if (!(_.isUndefined(results.error))) {
                        $scope.panel.error = $scope.parse_error(results.error);
                        return;
                    }
                    
                    // Check that we're still on the same query, if not stop
                    if ($scope.query_id === query_id) {
                        
                        // Keep only what we need for the set
                        $scope.data = $scope.data.slice(0, $scope.panel.size).concat(_.map(results.hits.hits, function(hit) {
                            var tooltipHTML = "";
                            for (var i = 0; i < tooltipArray.length && i < 2; i++) {
                                if (!_.isUndefined(hit.fields[tooltipArray[i]])) {
                                    tooltipHTML += hit.fields[tooltipArray[i]] + "</br>";
                                }
                            }
                            // Defaults
                            var mColor = "#48D1CC"
                              , mSize = 's';

                            if (!_.isUndefined($scope.panel.viz_type) && $scope.panel.viz_type === 'heatmap') {
                                // If cluster size is not set, return default size i.e small.
                                if (!_.isUndefined($scope.panel.parameter) && !_.isUndefined(hit.fields[$scope.panel.parameter][0])) {
                                    var value = hit.fields[$scope.panel.parameter][0];
                                    mSize = $scope.getMarkerSize($scope.panel, value);
                                }
                            }
                            
                            if (!_.isUndefined($scope.panel.parameter) && !_.isUndefined($scope.panel.cc) && !_.isUndefined(hit.fields[$scope.panel.parameter][0])) {
                                mColor = $scope.getMarkerColor($scope.panel, hit.fields[$scope.panel.parameter][0]);
                            }
                            
                            if (!_.isUndefined($scope.panel.viz_type) && $scope.panel.viz_type === 'cluster_size') {
                                // If cluster size is not set, return default size i.e small.
                                if (!_.isUndefined($scope.panel.parameter) && !_.isUndefined(hit.fields[$scope.panel.parameter][0])) {
                                    var value = hit.fields[$scope.panel.parameter][0];
                                    mSize = $scope.getMarkerSize($scope.panel, value);
                                }
                            }
                            
                            return {
                                coordinates: new L.LatLng(hit.fields[$scope.panel.field][0].split(',')[1],hit.fields[$scope.panel.field][0].split(',')[0]),
                                // TODO: Flip coordinates incase of lat,lon. Currently supporting lon, lat
                                tooltip: tooltipHTML,
                                popup: hit.fields,
                                color: mColor,
                                size: mSize
                            };
                        }
                        ));
                    
                    } else {
                        return;
                    }
                    
                    $scope.$emit('draw');
                    
                    // Get $size results then stop querying
                    if ($scope.data.length < $scope.panel.size && _segment + 1 < dashboard.indices.length) {
                        $scope.get_data(_segment + 1, $scope.query_id);
                    }
                
                }
                );
            }
            );
        }
        ;
        
        $scope.populate_modal = function(request) {
            $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
        }
        ;
    
    }
    );
    
    module.directive('bettermap', function() {
        return {
            restrict: 'A',
            link: function(scope, elem) {
                elem.html('<center><img src="img/load_big.gif"></center>');
                
                // Receive render events
                scope.$on('draw', function() {
                    render_panel();
                }
                );
                
                scope.$on('render', function() {
                    if (!_.isUndefined(map)) {
                        map.invalidateSize();
                        map.getPanes();
                    }
                }
                );
                
                var map, layerGroup;
                
                function render_panel() {
                    elem.css({
                        height: scope.panel.height || scope.row.height
                    });
                    scope.require(['./leaflet/plugins', './leaflet/Leaflet.MakiMarkers', './d3/d3.v3.min', './leaflet/leaflet-d3', './leaflet/leaflet-heat'], function() {
                        scope.panelMeta.loading = false;
                        if (scope.panel.viz_type === 'heatmap') {
                            if (_.isUndefined(map)) {
                                map = L.map(scope.$id, {
                                    scrollWheelZoom: false,
                                    center: [22.917923, 77.519531],
                                    zoom: 5
                                });
                                
                                // This could be made configurable?
                                L.tileLayer(scope.panel.tileServerUrl, {
                                    attribution: 'OSM'
                                }).addTo(map);
                                
                                var lowHeat = L.heatLayer([], {
                                    radius : scope.panel.hmap.radius , // default value
                                    blur : scope.panel.hmap.blur, // default value
                                    gradient : JSON.parse(scope.panel.cc.small)//{0.2: 'blue', 0.3: 'lime', 0.65: 'yellow', 0.97: 'yellow', 1: 'red'} // Values can be set for a scale of 0-1
                                }).addTo(map);

                                var mediumHeat = L.heatLayer([], {
                                    radius : scope.panel.hmap.radius , // default value
                                    blur : scope.panel.hmap.blur, // default value
                                    gradient : JSON.parse(scope.panel.cc.medium)//{0.4: 'blue', 0.6: 'lime', 0.75: 'yellow', 0.97: 'yellow', 1: 'red'} // Values can be set for a scale of 0-1
                                }).addTo(map);
                                
                                var highHeat = L.heatLayer([], {
                                    radius : scope.panel.hmap.radius , // default value
                                    blur : scope.panel.hmap.blur, // default value
                                    gradient : JSON.parse(scope.panel.cc.large)//{0.6: 'blue', 0.8: 'lime', 0.95: 'yellow', 0.97: 'yellow', 1: 'red'} // Values can be set for a scale of 0-1
                                }).addTo(map);

                                _.each(scope.data, function(p) {
                                    //Check average value and add to heat map
                                    if(p.size === 's') {
                                        lowHeat.addLatLng(p.coordinates);
                                    } else if(p.size === 'm') {
                                        mediumHeat.addLatLng(p.coordinates);
                                    } else {
                                        highHeat.addLatLng(p.coordinates);
                                    }
                                });
                            } else {
                                layerGroup.clearLayers();
                            }
                        } else {
                            var markerList = [];
                            L.Icon.Default.imagePath = 'app/panels/bettermap/leaflet/images';
                            if (_.isUndefined(map)) {
                                map = L.map(scope.$id, {
                                    scrollWheelZoom: false,
                                    center: [22.917923, 77.519531],
                                    zoom: 5
                                });
                                
                                // This could be made configurable?
                                L.tileLayer(scope.panel.tileServerUrl, {
                                    attribution: 'OSM'
                                }).addTo(map);
                                
                                if (_.isUndefined(scope.panel.clusterRadius)) {
                                    scope.panel.clusterRadius = 30;
                                }
                                
                                layerGroup = new L.MarkerClusterGroup({
                                    singleMarkerMode: true,
                                    // Remove to show markers when cluster size is one
                                    maxClusterRadius: scope.panel.clusterRadius,
                                    iconCreateFunction: function(t) {
                                        var e = t.getChildCount()
                                          , i = " marker-cluster-";
                                        var total = 0
                                          , average = 0;
                                        for (var index = 0; index < t.getAllChildMarkers().length; index++) {
                                            total += t.getAllChildMarkers()[index].options.alt;
                                        }
                                        average = total / t.getChildCount();
                                        var clusterColor = scope.getMarkerColor(scope.panel, average);
                                        var markerType = scope.getMarkerSize(scope.panel, average);
                                        var r = scope.hexToRgb(clusterColor).r
                                          , 
                                        g = scope.hexToRgb(clusterColor).g
                                          , 
                                        b = scope.hexToRgb(clusterColor).b;
                                        var isMarkerSizeEnabled = scope.panel.viz_type == 'cluster_size' ? true : false;
                                        
                                        return isMarkerSizeEnabled ? i += markerType : "",
                                        new L.DivIcon({
                                            html: "<div style='background-color: rgba(" + r + ", " + g + ", " + b + ", " + 0.65 + ")'><span>" + e + "</span></div>",
                                            className: "marker-cluster" + i,
                                            iconSize: new L.Point(40,40),
                                            backgroundColor: 'rgba(' + r + ', ' + g + ', ' + b + ', ' + 0.6 + ')'
                                        })
                                    }
                                });
                                /* Adding blip */
                                var options = {
                                    lng: function(d) {
                                        return d[0];
                                    },
                                    lat: function(d) {
                                        return d[1];
                                    },
                                    duration: 2000
                                };
                                
                                var pingLayer = L.pingLayer(options).addTo(map);
                                pingLayer.radiusScale().range([2, 12]);
                                pingLayer.opacityScale().range([1, 0]);
                                // This makes the difference
                                scope.pingLayer = pingLayer;
                                
                                scope.poll_for_data();
                                //should be called every few(equal to duration of animation/poll duration) seconds 
                                /* Blip End */
                            } else {
                                layerGroup.clearLayers();
                            }
                            
                            loadMarkers(scope);
                            
                            layerGroup.addLayers(markerList);
                            
                            layerGroup.addTo(map);
                            
                            function loadMarkers(scope) {
                                _.each(scope.data, function(p) {
                                    var icon = L.MakiMarkers.icon({
                                        icon: "circle",
                                        color: p.color,
                                        size: p.size
                                    });
                                    /*var greenIcon = L.icon({
                                        iconUrl: 'img/marker/red.png',
                                        iconSize: [16, 16],
                                        iconAnchor: [8, 8],
                                    });*/
                                    var myMarker = L.marker(p.coordinates, {
                                        icon: icon,
                                        alt: p.popup[scope.panel.parameter][0] !== undefined ? p.popup[scope.panel.parameter][0] : ""
                                    });
                                    var popupHtml = '<div class="custom-popup"><table>';
                                    for (var key in p.popup) {
                                        popupHtml += '<tr><td>' + capitalizeFirstLetter(key) + '</td><td>' + capitalizeFirstLetter(p.popup[key]) + '</tr>';
                                    }
                                    popupHtml += '<tr><td><div><div></td><td><div style="color: blue;text-decoration: underline;">More Details<div></td></tr>';
                                    popupHtml += '</table></div>';
                                    myMarker.bindPopup(popupHtml);
                                    if (!_.isUndefined(p.tooltip) && p.tooltip !== '') {
                                        markerList.push(myMarker.bindLabel(_.isArray(p.tooltip) ? p.tooltip[0] : p.tooltip));
                                    } else {
                                        markerList.push(myMarker);
                                    }
                                    
                                    function capitalizeFirstLetter(string) {
                                        if (typeof string === 'string') {
                                            return string.charAt(0).toUpperCase() + string.slice(1);
                                        } else {
                                            return string;
                                        }
                                    }
                                }
                                );
                            }
                        }
                    
                    }
                    );
                }
            }
        };
    }
    );

}
);
