function pasteHostData(hostdata) {
    let index = hostdata.indexOf('@');
    let pubkey = hostdata.substring(0, index);
    $("#peer-connect_txt_node_pubkey").val(pubkey);
    if (hostdata.includes(":")) {
        let indexColoms = hostdata.indexOf(':');
        let host = hostdata.substring(++index, indexColoms);
        let port = hostdata.substring(++indexColoms, hostdata.length);
        $("#peer-connect_txt_host").val(host);
        $("#peer-connect_txt_port").val(port);
    }
}

function updatePeerList(){
    $.ajax({
        url: "/get-peers",
        type: "POST",
        success: function (fragment) {
            $("#peer-list-fragment").replaceWith(fragment);
        },
        error: function (data) {
            var error = JSON.parse(data['responseText']);
            Snackbar.show({
                text: error['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function openPeerDetails(peer_pubkey, lnd_name){

    $.ajax({
        url: "/get-peer-details",
        type: "POST",
        data: {
            "peer_pubkey": peer_pubkey,
            "lnd_name": lnd_name
        },
        success: function (fragment) {
            $("#peer-details-peer_page").replaceWith(fragment);
        },
        error: function (data) {
            var error = JSON.parse(data['responseText']);

            error_msg = "";
            if (error['message'] == '') {
                if (error.hasOwnProperty('error') && error['error'] != '') {
                    error_msg = error['error'];
                }else{
                    error_msg = "Failed to Get Peer Details";
                }
            }else{
                error_msg = error['message'];
            }

            Snackbar.show({
                text: error_msg,
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function connectToPeer(){
    $.ajax({
        url: "/connect-peer",
        type: "POST",
        data: {
            "node_key": $("#peer-connect_txt_node_pubkey").val(),
            "hostname": $("#peer-connect_txt_host").val(),
            "port": $("#peer-connect_txt_port").val(),
            "password": $("#modal-passphrase-popup_txt_password").val(),
            "passphrase": $("#modal-passphrase-popup_txt_passphrase").val()
        },
        beforeSend: function () {
            $("#passphraseModal").modal('hide');
            setButtonState("#peer-connect_btn_connect", "Connecting.....", true);
        },
        success: function (response) {
            setButtonState("#peer-connect_btn_connect", "Connect", false);
            var success = JSON.parse(response);
            Snackbar.show({
                text: "Successfully Connected to Peer",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42',
                width: 'auto'
            });
        },
        error: function (data) {
            setButtonState("#peer-connect_btn_connect", "Connect", false);
            var error = JSON.parse(data['responseText']);
            Snackbar.show({
                text: error ['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a',
            });
        }
    });
}
function setButtonState(id, text, isLoading ){
    $(id).prop('disabled', isLoading);
    $(id).html(((isLoading)?
        '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"feather feather-loader spin\">\n' +
        '<line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"6\"></line>\n' +
        '<line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"22\"></line>\n' +
        '<line x1=\"4.93\" y1=\"4.93\" x2=\"7.76\" y2=\"7.76\"></line>\n' +
        '<line x1=\"16.24\" y1=\"16.24\" x2=\"19.07\" y2=\"19.07\"></line>\n' +
        '<line x1=\"2\" y1=\"12\" x2=\"6\" y2=\"12\"></line>\n' +
        '<line x1=\"18\" y1=\"12\" x2=\"22\" y2=\"12\"></line>\n' +
        '<line x1=\"4.93\" y1=\"19.07\" x2=\"7.76\" y2=\"16.24\"></line>\n' +
        '<line x1=\"16.24\" y1=\"7.76\" x2=\"19.07\" y2=\"4.93\"></line>\n' +
        '</svg> ':'')+text);
}