(
  typeof define === "function" ? function (m) { define("kismet-ui-js", m); } :
  typeof exports === "object" ? function (m) { module.exports = m(); } :
  function(m){ this.kismet_ui = m(); }
)(function () {

"use strict";

var exports = {};

// Set panels to close on escape system-wide
jsPanel.closeOnEscape = true;

// List of datatable columns we have available
exports.DeviceColumns = new Array();

/* Add a jquery datatable column that the user can pick from, with various 
 * options:
 *
 * sTitle: datatable column title
 * name: datatable 'name' field (optional)
 * field: Kismet field path or array pair of field path and name
 * renderfunc: string name of datatable render function, taking DT arguments
 *  (data, type, row, meta), (optional)
 * drawfunc: string name of a draw function, taking arguments:
 *  dyncolumn - The dynamic column (this)
 *  datatable - A DataTable() object of the table we're operating on
 *  row - The row we're operating on, which should be visible
 *  This will be called during the drawCallback
 *  stage of the table, on visible rows. (optional)
 */
exports.AddDeviceColumn = function(id, options) {
    var coldef = {
        kismetId: id,
        sTitle: options.sTitle,
        field: options.field,
    };

    if ('name' in options) {
        coldef.name = options.name;
    }

    if ('orderable' in options) {
        coldef.bSortable = options.orderable;
    }

    if ('visible' in options) {
        coldef.bVisible = options.visible;
    }

    if ('searchable' in options) {
        coldef.bSearchable = options.searchable;
    }

    if ('width' in options)
        coldef.width = options.width;

    var f;
    if (typeof(coldef.field) === 'string') {
        var fs = coldef.field.split("/");
        f = fs[fs.length - 1];
    } else if (Array.isArray(coldef.field)) {
        f = coldef.field[1];
    }

    console.log("field", coldef.field, "using", f);

    // coldef.mData = f.replace(/\./g, '_');
    // f = f.replace(/\./g, '_');

    coldef.mData = function(row, type, set) {
        return kismet.ObjectByString(row, f);
    }

    // Set the render function to proxy through the module+function
    if ('renderfunc' in options) {
        coldef.mRender = options.renderfunc;
    }

    // Set an arbitrary draw hook we call ourselves during the draw loop later
    if ('drawfunc' in options) {
        coldef.kismetdrawfunc = options.drawfunc;
    }

    exports.DeviceColumns.push(coldef);
}

/* Return columns from the selected list of column IDs */
exports.GetDeviceColumns = function(selected) {
    var ret = new Array();

    for (var i in exports.DeviceColumns) {
        // console.log("Adding column " + exports.DeviceColumns[i].kismetId);
        ret.push(exports.DeviceColumns[i]);
    }

    return ret;
}

exports.DeviceDetails = new Array();

/* Register a device detail accordion panel, taking an id for the panel 
 * content, a title presented to the user, a position in the list, and
 * options.  Because details are directly rendered all the time and
 * can't be moved around / saved as configs like columns can, callbacks
 * are just direct functions here.
 *
 * filter and render take one argument, the data to be shown
 * filter: function(data) {
 *  return false;
 * }
 *
 * render: function(data) {
 *  return "Some content";
 * }
 *
 * draw takes the device data and a container element as an argument:
 * draw: function(data, element) {
 *  e.append("hi");
 * }
 * */
exports.AddDeviceDetail = function(id, title, position, options) {
    var settings = $.extend({
        "filter": null,
        "render": null,
        "draw": null
    }, options);

    var det = {
        id: id,
        title: title,
        position: position,
        options: settings
    };

    exports.DeviceDetails.push(det);

    exports.DeviceDetails.sort(function(a, b) {
        return b.position < a.position;
    });
}

exports.GetDeviceDetails = function() {
    return exports.DeviceDetails;
}

exports.DeviceDetailWindow = function(key) {
    // Generate a unique ID for this dialog
    var dialogid = "devicedialog" + key;
    var dialogmatch = '#' + dialogid;

    if (jsPanel.activePanels.list.indexOf(dialogid) != -1) {
        jsPanel.activePanels.getPanel(dialogid).front();
        return;
    }

    var h = $(window).height() - 5;

    // If we're on a wide-screen browser, try to split it into 3 details windows
    var w = ($(window).width() / 3) - 10;

    // If we can't, split it into 2.  This seems to look better when people 
    // don't run full-size browser windows.
    if (w < 450) {
        w = ($(window).width() / 2) - 5;
    }

    // Finally make it full-width if we're still narrow
    if (w < 450) {
        w = $(window).width() - 5;
    }

    var panel = $.jsPanel({
        id: dialogid,
        headerTitle: 'Device Details',

        headerControls: {
            iconfont: 'jsglyph',
            controls: 'closeonly',
        },

        position: {
            "my": "left-top",
            "at": "left-top",
            "of": "window",
            "offsetX": 2,
            "offsetY": 2,
            "autoposition": "RIGHT"
        },

        resizable: {
            minWidth: 450,
            maxWidth: 600,
            minHeight: 400,
            stop: function(event, ui) {
                $('div#accordion', ui.element).accordion("refresh");
            }
        },

        onmaximized: function() {
            $('div#accordion', this.content).accordion("refresh");
        },

        onnormalized: function() {
            $('div#accordion', this.content).accordion("refresh");
        },

        callback: function() {
            var panel = this;
            var content = this.content;

            $.get("/devices/by-key/" + key + "/device.json")
                .done(function(fulldata) {
                    panel.headerTitle(fulldata['kismet_device_base_name']);

                    var accordion = $('<div />', {
                        id: 'accordion'
                    });

                    content.append(accordion);

                    var detailslist = kismet_ui.GetDeviceDetails();

                    for (var dii in detailslist) {
                        var di = detailslist[dii];

                        // Do we skip?
                        if ('filter' in di.options &&
                                typeof(di.options.filter) === 'function') {
                            if (di.options.filter(fulldata) == false) {
                                continue;
                            }
                        }

                        var vheader = $('<h3 />', {
                            id: "header" + di.id,
                            html: di.title
                        });

                        var vcontent = $('<div />', {
                            id: di.id,
                            //class: 'autosize'
                        });

                        // Do we have pre-rendered content?
                        if ('render' in di.options &&
                                typeof(di.options.render) === 'function') {
                            vcontent.html(di.options.render(fulldata));
                        }

                        accordion.append(vheader);
                        accordion.append(vcontent);

                        if ('draw' in di.options &&
                                typeof(di.options.draw) === 'function') {
                            di.options.draw(fulldata, vcontent);
                        }
                    }
                    accordion.accordion({ heightStyle: 'fill' });
                });
        }
    }).resize({
        width: w, 
        height: h,
        callback: function(panel) {
            $('div#accordion', this.content).accordion("refresh");
        },
    });

    // Did we creep off the screen in our autopositioning?  Put this panel in
    // the left if so (or if it's a single-panel situation like mobile, just
    // put it front and center)
    if (panel.offset().left + panel.width() > $(window).width()) {
        panel.reposition({
            "my": "left-top",
            "at": "left-top",
            "of": "window",
            "offsetX": 2,
            "offsetY": 2,
        });
    }
};

exports.RenderTrimmedTime = function(opts) {
    return (new Date(opts['value'] * 1000).toString()).substring(4, 25);
}

exports.RenderHumanSize = function(opts) {
    return kismet.HumanReadableSize(opts['value']);
};

// Central location to register channel conversion lists.  Conversion can
// be a function or a fixed dictionary.
exports.freq_channel_list = { };

exports.AddChannelList = function(phyname, channellist) {
    exports.freq_channel_list[phyname] = channellist;
}

// Get a list of frequency conversions
exports.GetChannelListKeys = function() {
    return Object.keys(exports.freq_channel_list);
}

// Get a converted channel name, or the raw frequency if we can't help
exports.GetConvertedChannel = function(phyname, frequency) {
    if (phyname in exports.freq_channel_list) {
        var conv = exports.freq_channel_list[phyname];

        if (typeof(conv) === "function") {
            // Call the conversion function if one exists
            return conv(frequency);
        } else if (frequency in conv) {
            // Return the mapped value
            return conv[frequency];
        }
    }

    // Return the frequency if we couldn't figure out what to do
    return frequency;
}

exports.connection_error = false;
exports.connection_error_panel = null;

exports.HealthCheck = function() {
    var timerid;
    
    $.get("/system/status.json")
    .done(function() {
        if (exports.connection_error) {
            exports.connection_error_panel.close();
        }

        exports.connection_error = false;
    })
    .fail(function() {
        if (!exports.connection_error) {
            exports.connection_error_panel = $.jsPanel({
                id: "connection-alert",
                headerTitle: 'Cannot Connect to Kismet',
                headerControls: {
                    controls: 'none',
                    iconfont: 'jsglyph',
                },
                contentSize: "auto auto",
                paneltype: 'modal',
                content: '<div style="padding: 10px;"><h3><i class="fa fa-exclamation-triangle" style="color: red;" /> Sorry!</h3><p>Cannot connect to the Kismet webserver.  Make sure Kismet is still running on this host!<p><i class="fa fa-refresh fa-spin" style="margin-right: 5px" /> Connecting to the Kismet server...</div>',
            });
        }

        exports.connection_error = true;
    })
    .always(function() {
        if (exports.connection_error)
            timerid = setTimeout(exports.HealthCheck, 1000);
        else
            timerid = setTimeout(exports.HealthCheck, 5000);
    });

}


exports.DegToDir = function(deg) {
    var directions = [
        "N", "NNE", "NE", "ENE", 
        "E", "ESE", "SE", "SSE", 
        "S", "SSW", "SW", "WSW", 
        "W", "WNW", "NW", "NNW"
    ];

    var degrees = [
        0, 23, 45, 68, 
        90, 113, 135, 158, 
        180, 203, 225, 248, 
        270, 293, 315, 338
    ];

    for (var p = 1; p < degrees.length; p++) {
        if (deg < degrees[p])
            return directions[p - 1];
    }

    return directions[directions.length - 1];
}

// Use our settings to make some conversion functions for distance and temperature
exports.renderDistance = function(k, precision = 5) {
    if (kismet.getStorage('kismet.base.unit.distance') === 'metric') {
        return k.toFixed(precision) + ' km';
    } else {
        return (k * 0.621371).toFixed(precision) + ' miles';
    }
}

exports.renderSpeed = function(kph, precision = 5) {
    if (kismet.getStorage('kismet.base.unit.speed') === 'metric') {
        return kph.toFixed(precision) + ' KPH';
    } else {
        return (kph * 0.621371).toFixed(precision) + ' MPH';
    }
}

exports.renderTemperature = function(c, precision = 5) {
    if (kismet.getStorage('kismet.base.unit.temp') === 'celcius') {
        return c.toFixed(precision) + '&deg; C';
    } else {
        return (c * (9/5) + 32).toFixed(precision) + '&deg; F';
    }
}

return exports;

});

