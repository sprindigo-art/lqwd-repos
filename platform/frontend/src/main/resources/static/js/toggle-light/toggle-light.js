$(document).ready(function (){
    $("#light-dark-toggle").on('click', function (){
        var checked = $("#light-dark-toggle").is(":checked");
        console.log("Toggle " + checked);
        $.ajax({
            url: "/toggle-color",
            type: "GET",
            data: {
                'light' : checked
            },
            success: function (response){
                window.location.reload();
            },
            error: function (response){
                window.location.href = "/logout";
            }
        });
    });
});