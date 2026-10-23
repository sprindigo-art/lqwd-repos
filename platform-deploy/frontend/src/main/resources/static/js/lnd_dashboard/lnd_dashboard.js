// function openDetails(lnd_name) {
//     window.open("/lnd-details?lnd_name=" + lnd_name, "_self");
// }

function redirectChannel(){
    window.open("/open-lnd-channel", "_self");
}

function copyHostData(hostdata) {
    try {
        navigator.clipboard.writeText(hostdata);

        Snackbar.show({
            text: "Successfully Copied ",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy to Clipboard",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}

function createNode(network, password, routing, breez, alias, passphrase, keySend) {

    let data = {
        'network': network,
        'password': password,
        'routing': routing,
        'breez' : breez,
        'alias': alias,
        'keySend': keySend
    };
    if(passphrase != null){
        data['passphrase'] =  passphrase
    }
    $.ajax({
        url: "/create-node",
        type: "POST",
        data: data,
        beforeSend: function () {
            $("#createNodeModal").modal('hide');
            blockArea('#lnd-node-list', "Creating LND Node...");
        },
        success: function (response) {
            var response = JSON.parse(response);
            Snackbar.show({
                text: response['message'],
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            $('#lnd-node-passphrase').val("");
            unblockArea('#lnd-node-list', "");
            updateNodeList();
            getLndNodes();
        },
        error: function (response) {
            var response = JSON.parse(response.responseText);
            if (response['status'] == 403){
                window.location = '/signout';
            }
            Snackbar.show({
                text: response['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            unblockArea('#lnd-node-list', "");
            updateNodeList();
            getLndNodes();
        }
    });
}

function getSeed(nodeName){

    //creat random number list
    var number_list = [];
    while (number_list.length < 3){
        var number = Math.floor(Math.random()*23);
        if(!number_list.includes(number)){
            number_list.push(number);
        }
    }
    // let number_list = [Math.floor(Math.random()*23),Math.floor(Math.random()*23),Math.floor(Math.random()*23)];
    number_list = number_list.sort(function (a, b) {  return a - b;  });
    $("#mnemonicModal").attr("data-nodeName", nodeName);

    console.log(number_list);

    $.ajax({
        url: "/get-seed",
        type: "POST",
        data: {
            "nodeName": nodeName
        },
        success: function (response) {
            response = JSON.parse(response);
            console.log(response);
            var seed = response['object'].split(",");

            $("#mnemonic-seed-cpy-btn").attr("data-seed", response['object']);
            $("#exampleModalLabel").innerHTML = "Mnemonic Seed for " + nodeName;

            for (let i = 0; i < seed.length; i++) {
                let key = i+1;
                $("#mnemonic-seed-list").append('<li class="list-group-item">'+key+'. '+seed[i]+'</li>');
            }

            $("#labelWord1").text("Enter Word " + (number_list[0]+1));
            $("#labelWord1").attr('data-value', number_list[0]);

            $("#labelWord2").text("Enter Word " + (number_list[1]+1));
            $("#labelWord2").attr('data-value', number_list[1]);

            $("#labelWord3").text("Enter Word " + (number_list[2]+1));
            $("#labelWord3").attr('data-value', number_list[2]);

            $("#mnemonicModal").modal("show");

        },
        error: function (response) {
            var error = JSON.parse(response['responseText']);
            console.log(error);
            if (error['object'] === 'Cannot get seed') {
                swal({
                    title: 'Seed Expired',
                    text: "Please delete and re-create node... \nNode and Seed must be confirmed within 30 minutes.",
                    type: 'error',
                    padding: '2em',
                    confirmButtonColor: '#009EE2'
                });
            }else{
                showPopup(error['object'], true);
            }
        }
    });
}

function copySeed(e){
    try {
        navigator.clipboard.writeText(e.dataset.seed);

        Snackbar.show({
            text: "Successfully Copied Seed",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy Seed",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}

function printSeed(){
        var contents = document.getElementById("mnemonic-seed-list").innerHTML;
        var frame1 = document.createElement('iframe');

        frame1.name = "frame1";
        frame1.style.position = "absolute";
        frame1.style.top = "-1000000px";
        document.body.appendChild(frame1);

        var frameDoc = frame1.contentWindow ? frame1.contentWindow : frame1.contentDocument.document ? frame1.contentDocument.document : frame1.contentDocument;

        frameDoc.document.open();
        frameDoc.document.write('<html><body>');
        frameDoc.document.write(contents);
        frameDoc.document.write('</body></html>');
        frameDoc.document.close();

        setTimeout(function () {
            window.frames["frame1"].focus();
            window.frames["frame1"].print();
            document.body.removeChild(frame1);
        }, 500);
        return false;
}

function confirmSeed(){

    var word1 = $("#word1").val();
    var word2 = $("#word2").val();
    var word3 = $("#word3").val();

    var word1_num = $("#labelWord1").data('value');
    var word2_num = $("#labelWord2").data('value');
    var word3_num = $("#labelWord3").data('value');

    console.log(word1, word2, word3, word1_num, word2_num, word3_num)
    var seed = $("#mnemonic-seed-cpy-btn").data('seed').split(",");
    var nodeName = $("#mnemonicModal").data('nodename');

    if (word1 === seed[word1_num] && word2 === seed[word2_num] && word3 === seed[word3_num]){
        blockArea("#mnemonicModal", "Confirming and Validating Node...");

        $.ajax({
            url: "/confirm-seed",
            type: "POST",
            data: {
                "nodeName": nodeName
            },
            success: function (response) {
                console.log(response);

                unblockArea("#mnemonicModal");
                $("#mnemonicModal").modal('hide');

                response = JSON.parse(response);
                showPopup(response['object']);
                updateNodeList();
                getLndNodes();
            },
            error: function (response) {
                console.log(response);
                unblockArea("#mnemonicModal");

                response = JSON.parse(response['responseText']);
                showPopup(response, true);

            }
        });
    }else{
        showPopup("Incorrect Words, Please Make Sure to Copy Down in Correct Order", true);
    }
}

function checkToUpdate(){
    let shouldUpdate = false
    $(".badge").each(function(i, val) {
        var statusText = val.innerHTML;
        if(statusText != "RUNNING"){
            shouldUpdate = true;
        }
    });
    //if node is found with status of  creating. do a pull to get latest status again.
    if(shouldUpdate == true){
        updateNodeList();
    }
}

function updateNodeList() {
    $.ajax({
        url: "/get-node-list",
        type: "GET",
        success: function (fragment) {
            $("#lnd-node-list").replaceWith(fragment);

            //rebind popover effect
            $('.bs-popover').popover();

            $(".lnd-node-card-select-session").bind('click', function(){
                console.log($(this).data('lnd'));
                setLndNodeSession($(this).data('lnd'));
            });
            //check to see if any node is in creating state.
            //if it is continuously check for node status to updated node list.
            setTimeout(checkToUpdate,60000);
        },
        error: function (data){
            console.log(data);
            var error = JSON.parse(data);
            if (error['status'] === 403){
                window.location = '/signout';
            }
            showPopup("Failed to Create LND Node", true);
        }
    });
}

function getWalletBalance() {
    $.ajax({
        url: "/get-wallet-balance",
        type: "GET",
        success: function (fragment) {
            $("#wallet_balance").replaceWith(fragment);
        },
        error: function (data) {
            Snackbar.show({
                text: "Could Not Load Wallet Balance",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function getLndNodeModalInfo(lnd_name) {
    //TODO: check if current version is still valid, just show the modal rather than getting from server.
    $.ajax({
        url: "/get-manage-node-details?lnd_name=" + lnd_name,
        type: "GET",
        beforeSend: function (){
            $("#lnd_details_modal_body").empty();
            $("#lnd_details_modal").modal('show');
            blockArea("#lnd_details_modal_body", "Loading LND Details...");
        },
        success: function (fragment){
            unblockArea("#lnd_details_modal_body", "Loading...");
            $("#lnd_details_modal_body").empty().append(fragment);
        },
        error: function (data){
            unblockArea("#lnd_details_modal_body", "Loading...");
            $("#lnd_details_modal").modal('hide');
            Snackbar.show({
                text: "Failed to Load LND Details",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

setTimeout(checkToUpdate(),10000);

function destroyLndNode(lnd_name, non_custodial, force) {
    if (non_custodial==="true"){
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
    }else{
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
    }
    if(force){
        $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'authorize("'+lnd_name+'", true);');
    }else{
        $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'authorize("'+lnd_name+'", false);');
    }
    $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
        if (e.which === 13) {
            e.preventDefault();
            if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                authorize(lnd_name);
            } else {
                $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
            }
        }
    });
    $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
        if (e.which === 13) {
            e.preventDefault();
            authorize(lnd_name);
        }
    });
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");
    $("#passphraseModal").modal('show');
}

function authorize(lnd_name,force) {
    var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
    var password = $("#modal-passphrase-popup_txt_password").val();
    $.ajax({
        url: '/close-lnd-node',
        type: "POST",
        data: {
            'password': password,
            'passphrase': passphrase,
            'lnd_name': lnd_name,
            'force': force
        },
        beforeSend: function (){
            $("#passphraseModal").modal("hide");
            blockArea("#lnd_details_modal_body", "Deleting LND Node...");
        },
        success: function (response) {
            unblockArea("#lnd_details_modal_body", "Deleting LND Node...");
            $("#passphraseModal").modal("hide");
            Snackbar.show({
                text: "Successfully Destroyed LND Node",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            $("#lnd_details_modal").modal('hide');
            updateNodeList();
            getLndNodes();
        },
        error: function (response) {
            let error = JSON.parse(response['responseText']);
            unblockArea("#lnd_details_modal_body", "Deleting LND Node...");
            Snackbar.show({
                text: error['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            updateNodeList();
            getLndNodes();
        }
    });

}

