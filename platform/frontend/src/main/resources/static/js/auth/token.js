function checkToken(){
	$.ajax({
            url: '/token/check',
            type: "GET",
            success: function (response) {
               console.log(response)
            },
            error: function (response) {
                console.log(response)
                window.location = "/signout";
            }
        });  
    
}
setInterval(checkToken, 60*1000);
