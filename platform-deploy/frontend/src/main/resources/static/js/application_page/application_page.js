$(document).ready(function() {
    $("#application-page_btn_submit").on('click', function (e) {
        e.preventDefault();
        submitForm();
    });

    $(window).keydown(function(event){
        if(event.keyCode == 13) {
            event.preventDefault();
            return false;
        }
    });
});

function submitForm() {
    let company_name = $("#application-page_txt_company-name").val();
    let contact_name = $("#application-page_txt_contact_name").val();
    let email = $("#application-page_txt_email").val();
    let phone_number = $("#application-page_txt_phone-number").val();
    let company_address = $("#application-page_txt_address").val();
    let country = $("#application-page_txt_country").val();
    let zip_code = $("#application-page_txt_postal_code").val();
    let url = $("#application-page_url_company_url").val();
    let policy = $("#application-page_chk_policy").is(':checked');
    let product_info = $("#application-page_txt_product-info").val();
    let solution = $("#application-page_txt_solution").val();
    let goal = $("#application-page_txt_goal").val();

    $.ajax({
        url: '/save-business',
        type: "POST",
        data: {
            'companyName': company_name,
            'contactName': contact_name,
            'contactEmail': email,
            'contactPhone': phone_number,
            'companyAddress': company_address,
            'countryCode': country,
            'zipCode': zip_code,
            'companyUrl': url,
            'hasKyc': policy,
            'productInfo': product_info,
            'currentSolution': solution,
            'goal': goal
        },
        beforeSend: function (){
            $.each($(".error-response"), function (){
                $(this).replaceWith("<span class='small error-response'></span>");
            });
        },
        success: function (response) {
            swal({
                title: 'Thanks for Applying!',
                text: "We will review your request and contact you shortly",
                type: 'success',
                padding: '2em',
                confirmButtonColor: '#009EE2'
            })
        },
        error: function (response) {
            response = JSON.parse(response['responseText']);

            if (response.hasOwnProperty('errors')) {
                $.each(response['errors'], function (index, value) {
                    $("input[name='" + index + "']").next().replaceWith("<span class='small error-response'>* " + value + "</span>");
                });
            }
            if(response['message'] !== ''){
                Snackbar.show({
                    text: response['message'],
                    pos: 'top-center',
                    duration: false,
                    actionTextColor: '#fff',
                    backgroundColor: '#e7515a'
                });
            }else{
                Snackbar.show({
                    text: "Please Fill in Required Fields",
                    pos: 'top-center',
                    duration: false,
                    actionTextColor: '#fff',
                    backgroundColor: '#e7515a'
                });
            }
        }
    });
}