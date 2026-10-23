function setLndNodeSession(lnd_name){
    console.log("Session Set LND Node: " + lnd_name);
    $.ajax({
        url: "/set-lnd-session",
        type: "GET",
        data: {
            'lnd_name' : lnd_name
        },
        success: function (response){
            console.log(response)
            window.location.reload();
        },
        error: function (response){
            console.log(response);
            Snackbar.show({
                text: "Failed to Save LND for Session",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function getLndNodes(){
    var lnd_name = document.getElementById("session-label");

    if (lnd_name){
        console.log("blocking");
        blockArea('#container', "Please wait...");
    }
    $.ajax({
        url: "/get-lnd-nodes",
        type: "GET",
        success: function (fragment){
            $("#select-picker-div").replaceWith(fragment);
            $("#lnd-node-session-select").selectpicker('refresh');
            $("#lnd-node-session-select").bind('change',  function (){
                console.log("Session Change to LND: " + $("#lnd-node-session-select :selected").val());
                setLndNodeSession($("#lnd-node-session-select :selected").val())
            });
             unblockArea('#container', "Please wait...");
        },
        error: function (response){
	 		unblockArea('#container', "Please wait...");
            console.log(response);
        }
    });
}
$(document).ready(function (){
    if (window.location.pathname !== "/" && window.location.pathname !== "/business-signup" &&
        window.location.pathname !== "/signup" && window.location.pathname !== "/login") {
        getLndNodes();
    }
    $("#lnd-node-session-select").on('change', function (){
        console.log("Session Change to LND: " + $("#lnd-node-session-select :selected").val());
        setLndNodeSession($("#lnd-node-session-select :selected").val())
    });
});