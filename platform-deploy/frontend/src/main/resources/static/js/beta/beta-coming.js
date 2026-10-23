function registerForBeta(captchaResponse) {
    $.ajax({
        url: '/beta/add-subscriber',
        type: "POST",
        data: {
            'email': $('#beta-coming-soon_txt_email').val(),
            'captchaResponse': captchaResponse
        },
        success: function (response) {
            Snackbar.show({
                text: "Successfully Added to Subscriber List",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
        },
        error: function (response) {
            var errorMessage = JSON.parse(response['responseJSON']['message']);
            console.log(errorMessage)
            Snackbar.show({
                text: errorMessage['error_description'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}