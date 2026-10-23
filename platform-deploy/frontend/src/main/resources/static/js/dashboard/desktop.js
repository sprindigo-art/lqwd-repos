$(document).ready(function() {
    $("#desktop_a_get-transactionhistory").on('click', function(event){
        event.preventDefault();
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }

    });
    $("#desktop_a_get-info").on('click', function(event){
        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }

    });

    $("#desktop_a_channels-info").on('click', function(event){
        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }
    });

    $("#desktop_a_peers-info").on('click', function(event){
        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }
    });


    $("#desktop_a_fees-info").on('click', function(event){
        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }
    });

    $("#desktop_a_wallet-balance-info").on("click", function(event){
        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }
    });

    $("#desktop_a_get-recovery-info").on("click", function(event){

        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }

    });

    $("#desktop_a_channel-balance-info").on("click", function(event){

        event.preventDefault(); //prevent default action
        var noncustodial = $("#desktop-slct_lnd-select :selected").data('custodial');
        if(noncustodial){
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><span style='color:white !important;'>Self managed node cannot be provided with Manage API</span></div>";
        } else {
            ajaxCallForActions($(this).attr("href"));
        }


    });
});


var requestArray = [];

function ajaxCallForActions(action){
    $.ajax({
        url: action,
        type: "POST",
        beforeSend: function(){
            blockArea("#desktop_div_results_box", "Loading...");
        },
        success: function (response) {
            if (response == null){
                window.location = "/signout";
            }
            unblockArea("#desktop_div_results_box", "");
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><pre style='color:white !important;'>" + JSON.stringify(JSON.parse(response), null, 2) + "</pre></div>";
        },
        error: function (response) {
            unblockArea("#desktop_div_results_box", "");
            document.getElementById("desktop_div_results_box").innerHTML = "<div ><pre style='color:white !important;'>" + JSON.stringify(JSON.parse(response['responseText']), null, 2) + "</pre></div>";
        }
    });
}

function addRequestArray(action, windowName){
    requestArray[action]=windowName;
    console.log("added");
    console.log(requestArray);
    sendRequest();
}

function removeRequestArray(action){
    delete requestArray[action];
    console.log(requestArray);
    console.log("removed");
}

function sendRequest() {

    if (typeof (EventSource) !== "undefined") {
        var source = new EventSource("/sseconsumer");

        source.onmessage = function (event) {
            if (Object.keys(requestArray).length > 0) {
                var json = JSON.parse(event.data);

                console.log(json);
                console.log(json.status);

                if (json.status !== 204) {
                    if (json.status === 403) {
                        $(location).attr('href');
                        //full
                        var pathname = window.location.href;
                        //just base
                        var val = location.pathname;
                        var new_pathname = pathname.replace(val, "/signout");
                        window.location.href = new_pathname;

                    } else {
                        var tact = json.tmessageKey.taction;
                        console.log(tact + ' -- status not 204 tmessageKey.taction');
                        if (tact == 'REPLY') {
                            tact = json.tmessage.taction
                            console.log(tact + ' -- updated from tmessage.taction');
                            if (tact == 'REPLY') {
                                tact = 'channels';
                            }
                        }
                    }
                }

                var w_name = requestArray[tact];

                console.log("desktop_div_results_box" + ' -- window name to show message');
                document.getElementById("desktop_div_results_box").innerHTML = "<div ><pre style='color:white !important;'>" + JSON.stringify(JSON.parse(json.tmessage.tmess), null, 2) + "</pre></div>";
                console.log("Removing "+json.tmessageKey.taction + " From Queue");
                removeRequestArray("/"+json.tmessageKey.taction);

            } else {
                source.close();
                console.log("Source closed!!!");
            }
        }
    }
}

function blockArea(area_id, message_str){
    var block = $(area_id);
    $(block).block({
        message: message_str +
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-loader spin">' +
            '<line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>' +
            '<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>' +
            '<line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line>' +
            '<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>' +
            '<line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>' +
            '</svg>',
        overlayCSS: {
            backgroundColor: '#000',
            opacity: 0.8,
            cursor: 'wait'
        },
        css: {
            border: 0,
            color: '#fff',
            padding: 0,
            backgroundColor: 'transparent'
        }
    });
}

function unblockArea(area_id, message_str){
    var block = $(area_id);
    $(block).block({
        message: message_str,
        timeout: 1,
        overlayCSS: {
            backgroundColor: '#000',
            opacity: 0.8,
            cursor: 'wait'
        },
        css: {
            border: 0,
            color: '#fff',
            padding: 0,
            backgroundColor: 'transparent'
        }
    });
}