// Display the channel records system from Kismet
//
// Requires js-storage and jquery be loaded first
// 
// dragorn@kismetwireless.net
// MIT/GPL License (pick one); the web ui code is licensed more
// freely than GPL to reflect the generally MIT-licensed nature
// of the web/jquery environment
//


(function($) {
    var element = null;

    var base_options = {
        url: ""
    };

    var options = base_options;

    var timerid = -1;

    var devgraph_container = null;

    var devgraph_chart = null;
    var timegraph_chart = null;

    var devgraph_canvas = null;
    var timegraph_canvas = null;

    var picker = null;
    var graphtype = null;
    var coming_soon = null;

    var visible = false;

    var storage = null;

    var channeldisplay_refresh = function() {
        clearTimeout(timerid);

        if (element.is(':hidden')) {
            timerid = -1;
            return;
        }

        $.get(options.url + "/channels/channels.json")
        .done(function(data) {
            var devtitles = new Array();
            var devnums = new Array();

            // Chart type from radio buttons
            var charttype = $("input[name='graphtype']:checked", graphtype).val();
            // Chart timeline from selector
            var charttime = $('select#historyrange option:selected', element).val();
            // Frequency translation from selector
            var freqtrans = $('select#k_cd_freq_selector option:selected', element).val();
            // Pull from the stored value instead of the live
            var filter_string = storage.get('jquery.kismet.channels.filter');

            // historical line chart
            if (charttype === 'history') {
                var pointtitles = new Array();
                var datasets = new Array();
                var title = "";

                var rrd_type = kismet.RRD_SECOND;
                var rrd_data = null;

                if (charttime === 'min') {
                    title = "Past Minute";

                    for (var x = 60; x > 0; x--) {
                        if (x % 5 == 0) {
                            pointtitles.push(x + 's');
                        } else {
                            pointtitles.push(' ');
                        }
                    }

                    rrd_type = kismet.RRD_SECOND;
                    rrd_data = "kismet_channelrec_device_rrd.kismet_common_rrd_minute_vec";
                } else if (charttime === 'hour') {
                    title = "Past Hour";

                    for (var x = 60; x > 0; x--) {
                        if (x % 5 == 0) {
                            pointtitles.push(x + 'm');
                        } else {
                            pointtitles.push(' ');
                        }
                    }

                    rrd_type = kismet.RRD_MINUTE;
                    rrd_data = "kismet_channelrec_device_rrd.kismet_common_rrd_hour_vec";

                } else /* day */ {
                    title = "Past Day";

                    for (var x = 24; x > 0; x--) {
                        if (x % 4 == 0) {
                            pointtitles.push(x + 'h');
                        } else {
                            pointtitles.push(' ');
                        }
                    }

                    rrd_type = kismet.RRD_HOUR;
                    rrd_data = "kismet_channelrec_device_rrd.kismet_common_rrd_day_vec";

                }

                // Position in the color map
                var colorpos = 0;
                var nkeys = Object.keys(data['kismet_channeltracker_frequency_map']).length;

                var filter = $('select#gh_filter', element);
                filter.empty();

                if (filter_string === '' || filter_string === 'any') {
                    filter.append(
                        $('<option>', {
                            value: "",
                            selected: "selected",
                        })
                        .text("Any")
                    );
                }  else {
                    filter.append(
                        $('<option>', {
                            value: "any",
                        })
                        .text("Any")
                    );
                }

                for (var fk in data['kismet_channeltracker_frequency_map']) {
                    var linedata = 
                        kismet.RecalcRrdData(
                            data['kismet_channeltracker_frequency_map'][fk]['kismet_channelrec_device_rrd']['kismet_common_rrd_last_time'], 
                            data['kismet_channeltracker_frequency_map'][fk]['kismet_channelrec_device_rrd']['kismet_common_rrd_last_time'], 
                            rrd_type,
                            kismet.ObjectByString(
                                data['kismet_channeltracker_frequency_map'][fk], 
                                rrd_data),
                            {});

                    // Convert the freq name
                    var cfk = kismet_ui.GetConvertedChannel(freqtrans, fk);

                    var label = "";

                    if (cfk == fk) 
                        label = kismet.HumanReadableFrequency(parseInt(fk));
                    else
                        label = cfk;

                    // Make a filter option
                    if (filter_string === fk) {
                        filter.append(
                            $('<option>', {
                                value: fk,
                                selected: "selected",
                            })
                            .text(label)
                        );
                    } else {
                        filter.append(
                            $('<option>', {
                                value: fk,
                            })
                            .text(label)
                        );
                    }

                    // Rotate through the color wheel
                    var color = parseInt(255 * (colorpos / nkeys));
                    colorpos++;

                    // Build the dataset record
                    var ds = {
                        label:  label,
                        fill: true,
                        lineTension: 0.1,
                        data: linedata,
                        borderColor: "hsl(" + color + ", 100%, 50%)",
                        backgroundColor: "hsl(" + color + ", 100%, 50%)",
                    };

                    // Add it to the dataset if we're not filtering
                    if (filter_string === fk || 
                        filter_string === '' || 
                        filter_string === 'any') {
                            datasets.push(ds);
                    }
                }

                devgraph_canvas.hide();
                timegraph_canvas.show();
                coming_soon.hide();

                if (timegraph_chart == null) {
                    var device_options = {
                        type: "bar",
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                yAxes: [{
                                    ticks: {
                                        beginAtZero: true,
                                    },
                                    stacked: true,
                                }],
				xAxes: [{
				    stacked: true,
				}],
                            },
                            legend: {
                                labels: {
                                    boxWidth: 15,
                                    fontSize: 9,
                                    padding: 5,
                                },
                            },
                        },
                        data: {
                            labels: pointtitles,
                            datasets: datasets,
                        }
                    };

                    timegraph_chart = new Chart(timegraph_canvas, 
                        device_options);
                } else {
                    timegraph_chart.data.datasets = datasets;
                    timegraph_chart.data.labels = pointtitles;

                    timegraph_chart.update(0);
                }
            } else {
                // 'now', but default - if for some reason we didn't get a
                // value from the selector, this falls through to the bar graph
                // which is what we probably really want
                for (var fk in data['kismet_channeltracker_frequency_map']) {
                    var slot_now =
                        (data['kismet_channeltracker_frequency_map'][fk]['kismet_channelrec_device_rrd']['kismet_common_rrd_last_time']) % 60;
                    var dev_now = data['kismet_channeltracker_frequency_map'][fk]['kismet_channelrec_device_rrd']['kismet_common_rrd_minute_vec'][slot_now];

                    var cfk = kismet_ui.GetConvertedChannel(freqtrans, fk);

                    if (cfk == fk) 
                        devtitles.push(kismet.HumanReadableFrequency(parseInt(fk)));
                    else
                        devtitles.push(cfk);

                    devnums.push(dev_now);
                }

                devgraph_canvas.show();
                timegraph_canvas.hide();

                if (devgraph_chart == null) {
                    coming_soon.hide();

                    var device_options = {
                        type: "bar",
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                yAxes: [{
                                    ticks: {
                                        beginAtZero: true,
                                    }
                                }],
                            },
                        },
                        data: {
                            labels: devtitles,
                            datasets: [
                                {
                                    label: "Devices per Channel",
                                    backgroundColor: 'rgba(160, 160, 160, 1)',
                                    data: devnums,
                                    borderWidth: 1,
                                }
                            ],
                        }
                    };

                    devgraph_chart = new Chart(devgraph_canvas, 
                        device_options);

                } else {
                    devgraph_chart.data.datasets[0].data = devnums;
                    devgraph_chart.data.labels = devtitles;

                    devgraph_chart.update();
                }
            }

        })
        .always(function() {
            timerid = setTimeout(channeldisplay_refresh, 5000);
        });
    };

    var update_graphtype = 
        function(gt = $("input[name='graphtype']:checked", graphtype).val()) {

        storage.set('jquery.kismet.channels.graphtype', gt);

        if (gt === 'now') {
            $("select#historyrange", graphtype).hide();
            $("select#gh_filter", graphtype).hide();
            $("label#gh_filter_label", graphtype).hide();
        } else {
            $("select#historyrange", graphtype).show();
            $("label#gh_filter_label", graphtype).show();
            $("select#gh_filter", graphtype).show();
        }

        charttime = $('select#historyrange option:selected', element).val();
        storage.set('jquery.kismet.channels.range', charttime);
    }

    $.fn.channels = function(inopt) {
        storage = Storages.localStorage;

        var stored_gtype = "now";
        var stored_channel = "Frequency";
        var stored_range = "min";

        if (storage.isSet('jquery.kismet.channels.graphtype'))
            stored_gtype = storage.get('jquery.kismet.channels.graphtype');

        if (storage.isSet('jquery.kismet.channels.channeltype'))
            stored_channel = storage.get('jquery.kismet.channels.channeltype');

        if (storage.isSet('jquery.kismet.channels.range'))
            stored_range = storage.get('jquery.kismet.channels.range');


        if (!storage.isSet('jquery.kismet.channels.filter'))
            storage.set('jquery.kismet.channels.filter', 'any');

        element = $(this);

        visible = element.is(":visible");

        if (typeof(inopt) === "string") {

        } else {
            options = $.extend(base_options, inopt);
        }

        var banner = $('div.k_cd_banner', element);
        if (banner.length == 0) {
            banner = $('<div>', {
                id: "banner",
                class: "k_cd_banner"
            });

            element.append(banner);
        }

        if (graphtype == null) {
            graphtype = $('<div>', {
                "id": "graphtype",
                "class": "k_cd_type",
            })
            .append(
                $('<label>', {
                    for: "gt_bar",
                })
                .text("Current")
            )
            .append($('<input>', {
                type: "radio",
                id: "gt_bar",
                name: "graphtype",
                value: "now",
                })
            )
            .append(
                $('<label>', {
                    for: "gt_line",
                })
                .text("Historical")
            )
            .append($('<input>', {
                type: "radio",
                id: "gt_line",
                name: "graphtype",
                value: "history"
            })
            )
            .append(
                $('<select>', {
                    id: "historyrange",
                    class: "k_cd_hr_list"
                })
                .append(
                    $('<option>', {
                        id: "hr_min",
                        value: "min",
                    })
                    .text("Past Minute")
                )
                .append(
                    $('<option>', {
                        id: "hr_hour",
                        value: "hour",
                    })
                    .text("Past Hour")
                )
                .append(
                    $('<option>', {
                        id: "hr_day",
                        value: "day",
                    })
                    .text("Past Day")
                )
                .hide()
            )
            .append(
                $('<label>', {
                    id: "gh_filter_label",
                    for: "gh_filter",
                })
                .text("Filter")
                .append(
                    $('<select>', {
                        id: "gh_filter"
                    })
                    .append(
                        $('<option>', {
                            id: "any",
                            value: "any",
                            selected: "selected",
                        })
                        .text("Any")
                    )
                )
                .hide()
            );

            // Select time range from stored value
            $('option#hr_' + stored_range, graphtype).attr('selected', 'selected');

            // Select graph type from stored value
            if (stored_gtype == 'now') {
                $('input#gt_bar', graphtype).attr('checked', 'checked');
            } else {
                $('input#gt_line', graphtype).attr('checked', 'checked');
            }

            banner.append(graphtype);

            update_graphtype(stored_gtype);

            graphtype.on('change', function() {
                update_graphtype();
                channeldisplay_refresh();
            });

            $('select#gh_filter', graphtype).on('change', function() {
                var filter_string = $('select#gh_filter option:selected', element).val();
                storage.set('jquery.kismet.channels.filter', filter_string);
                channeldisplay_refresh();
            });

        }

        if (picker == null) {
            picker = $('<div>', {
                id: "picker",
                class: "k_cd_picker",
            });

            var sel = $('<select>', {
                id: "k_cd_freq_selector",
                class: "k_cd_list",
            });

            picker.append(sel);

            var chlist = new Array();
            chlist.push("Frequency");

            chlist = chlist.concat(kismet_ui.GetChannelListKeys());

            for (var c in chlist) {
                var e = $('<option>', {
                    value: chlist[c], 
                }).html(chlist[c]);

                if (chlist[c] === stored_channel)
                    e.attr("selected", "selected");

                sel.append(e);
            }

            banner.append(picker);

            picker.on('change', function() {
                var freqtrans = 
                    $('select#k_cd_freq_selector option:selected', element).val();

                storage.set('jquery.kismet.channels.channeltype', freqtrans);

                channeldisplay_refresh();
            });

        }

        if (devgraph_container == null) {
            devgraph_container =
                $('<div>', {
                    class: "k_cd_container"
                });

            devgraph_canvas = $('<canvas>', {
                class: "k_cd_dg",
            });

            devgraph_container.append(devgraph_canvas);

            timegraph_canvas = $('<canvas>', {
                class: "k_cd_dg",
            });

            timegraph_canvas.hide();
            devgraph_container.append(timegraph_canvas);

            element.append(devgraph_container);
        }

        // Add a 'coming soon' item
        if (coming_soon == null)  {
            coming_soon = $('<i>', {
                "id": "coming_soon",
            });
            coming_soon.html("Channel data loading...");
            element.append(coming_soon);
        }

        // Hook an observer to see when we become visible
        var observer = new MutationObserver(function(mutations) {
            if (element.is(":hidden") && timerid >= 0) {
                visible = false;
                clearTimeout(timerid);
            } else if (element.is(":visible") && !visible) {
                visible = true;
                channeldisplay_refresh();
            }
        });

        observer.observe(element[0], {
            attributes: true
        });

        if (visible) {
            channeldisplay_refresh();
        }

    };

}(jQuery));

