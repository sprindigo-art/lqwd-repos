$(document).ready(function () {
    updatePage(1 );
});
function updatePage(page,startPageIndex,endPageIndex,updatePageSet) {
    console.log("we are in update!");
    $.ajax({
        url: "/get-peers",
        type: "GET",
        data: {
            'page': page,
            'startPageIndex': startPageIndex,
            'endPageIndex': endPageIndex,
            'updatePageSet': updatePageSet
        },

        success: function (fragment) {
            $("#peer-list_div_list").replaceWith(fragment);
        },
        error: function (response) {
            let error = JSON.parse(response['responseText']);
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

