function blockArea(area_id, message_str) {
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

function unblockArea(area_id, message_str) {
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

function showPopup(message, isError){
    Snackbar.show({
        text: message,
        pos: 'top-center',
        duration: false,
        actionTextColor: '#fff',
        backgroundColor: isError?'#e7515a':'#8dbf42'
    });
}

function copyToClipboard(text) {
    try {
        navigator.clipboard.writeText(text);

        Snackbar.show({
            text: "Successfully Copied",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}

function GetURLParameter(sParam)
{
    var sPageURL = window.location.search.substring(1);
    var sURLVariables = sPageURL.split('&');
    for (var i = 0; i < sURLVariables.length; i++)
    {
        var sParameterName = sURLVariables[i];
        var sParamIndex = sParameterName.substring(0, sParameterName.indexOf("="));
        var sParamValue = sParameterName.substring(sParameterName.indexOf("=") + 1);

        if (sParamIndex == sParam)
        {
            return sParamValue;
        }
    }
}

function isNonCustodial(lnd_name){
    let response;
    $.ajax({
        url: "/check-custodial?lnd_name="+lnd_name,
        type: "GET",
        async: false,
        timeout: 10000,
        success: function (data) {
            response = JSON.parse(data);
            return response['non-custodial'];
        },
        error: function (data) {
            console.log(data);
            return false;
        }
    });

    return response['non-custodial'];
}

function getNonCustodialPassphrase(e){
    console.log(e);
}

function loadingButton(id, button_message) {
    $("id").removeClass('btn-primary btn-lg');
    $("id").addClass('btn-outline-primary btn-lg');
    $("id").html(button_message +
        '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"feather feather-loader spin\">\n' +
        '<line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"6\"></line>\n' +
        '<line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"22\"></line>\n' +
        '<line x1=\"4.93\" y1=\"4.93\" x2=\"7.76\" y2=\"7.76\"></line>\n' +
        '<line x1=\"16.24\" y1=\"16.24\" x2=\"19.07\" y2=\"19.07\"></line>\n' +
        '<line x1=\"2\" y1=\"12\" x2=\"6\" y2=\"12\"></line>\n' +
        '<line x1=\"18\" y1=\"12\" x2=\"22\" y2=\"12\"></line>\n' +
        '<line x1=\"4.93\" y1=\"19.07\" x2=\"7.76\" y2=\"16.24\"></line>\n' +
        '<line x1=\"16.24\" y1=\"7.76\" x2=\"19.07\" y2=\"4.93\"></line>\n' +
        '</svg>');
}

function regularButton(id, button_message) {
    $("id").removeClass('btn-outline-primary btn-lg');
    $("id").addClass('btn-primary btn-lg');
    $("id").html(button_message);
}