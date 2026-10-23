let baseUrl = "";

let adminOptions = {};
let page = 0;
let pageTotal = 0;
let pageSize = 100;
let currentConfigureMethod = {};
var token = null;

function deleteCookie(cname){
    document.cookie = cname+"=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}
function setCookie(cname, cvalue, exdays) {
  const d = new Date();
  d.setTime(d.getTime() + (exdays*24*60*60*1000));
  let expires = "expires="+ d.toUTCString();
  document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function getCookie(cname) {
  let name = cname + "=";
  let decodedCookie = decodeURIComponent(document.cookie);
  let ca = decodedCookie.split(';');
  for(let i = 0; i <ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}

function updateMethodListConfigure(newOptions){
  var $el = $("#method_list_configure");
  $el.empty(); // remove old options
  $el.append($("<option></option>")
       .attr("value", "").text("Select Method"));
  $.each(newOptions, function(key, value) {
    $el.append($("<option></option>")
       .attr("value", value).text(value));
  });
}

function updateMethodListUpdate(newOptions){
  var $el = $("#method_list_update");
  $el.empty(); // remove old options
  $el.append($("<option></option>")
     .attr("value", "").text("Select Encryption/Decryption Method"));

  $.each(newOptions, function(key, value) {
    $el.append($("<option></option>")
       .attr("value", value).text(value));
  });

  $el.append($("<option></option>")
       .attr("value", "NONE").text("NONE"));
}

function updateFilterListUpdates(newOptions){
  var $el = $("#filter_list_update");
  $el.empty(); // remove old options
  $el.append($("<option></option>")
     .attr("value", "").text("None"));
  $.each(newOptions, function(key, value) {
    $el.append($("<option></option>")
       .attr("value", value).text(value));
  });
}

function updateFilterListValueUpdates(newOptions){
  var $el = $("#filter_list_value_update");
  $el.empty(); // remove old options
  $el.append($("<option></option>")
     .attr("value", "").text("All"));
  $.each(newOptions, function(key, value) {
    $el.append($("<option></option>")
       .attr("value", value).text(value));
  });
}

function loadOptions(){
  $.ajax({
      url: baseUrl+'/api/v1/admin/options',
      headers: {"Authorization": "Bearer "+token},
      type: 'GET',
      contentType: 'application/json',
      async: true,
      success: function(data) {
        adminOptions = data;
        updateMethodListConfigure(data.cipherMethods);
        updateMethodListUpdate(data.cipherMethods);
        loadFiles();
      },
      complete: function(xhr, textStatus) {
              console.log(xhr.status);
              if(xhr.status == 401 || xhr.status == "401"){
                     $("#application_div").hide();
                     $("#login_div").show();
                     deleteCookie("token");
              }
       }
  });
}


function doLogin(){
  var username = $("#username").val();
  var password = $("#password").val();

  if(username && password){
    var conf = { username: username, password: password };
    $.ajax({
        url: baseUrl+'/api/v1/login',
        type: 'POST',
        data: conf,
        // dataType: 'application/',
        success: function(msg) {
          token = msg.access_token;
          setCookie("token", token, 10);
          loadOptions();
          $("#login_div").hide();
          $("#application_div").show();
        },
        error: function (xhr, exception) {
          alert("Login failed try again")
          console.log(xhr)
          console.log(exception)
        }
    });
  }else{
    alert("Please provide your username and password");
  }
}


function testEncrypt(){
  var secretKey = $("#method_secret").val();
  var method = $("#method_list_configure").val();
  var text = $("#test_encrypt_text").val();

  if(!method){
    alert("Please select method");
    return;
  }

  if(!secretKey){
    alert("Please enter secret key");
    return;
  }

  if(!text){
    alert("Please enter text to encrypt");
    return;
  }
  $("#do_encrypt_test").prop( "disabled", true );
  $("#do_encrypt_test").text("Encrypting..");
  document.getElementById('test_decrypt_text').value = "";
  var conf = { methodName: method, secretKey: secretKey, text:text};
  $.ajax({
    url: baseUrl+'/api/v1/admin/testencrypt',
    headers: {"Authorization": "Bearer "+token},
    type: 'POST',
    data: JSON.stringify(conf),
    contentType: 'application/json',
    dataType: 'json',
    success: function(msg) {
        $("#do_encrypt_test").prop( "disabled", false );
        $("#do_encrypt_test").text("Encrypt");
        $("#test_decrypt_text").val(msg.data);
        document.getElementById('test_decrypt_text').value = msg.data;
    },
    error: function (xhr, exception) {
        $("#do_encrypt_test").prop( "disabled", false );
        $("#do_encrypt_test").text("Encrypt");
    }
  });
}



function testDecrypt(){
  var secretKey = $("#method_secret").val();
  var method = $("#method_list_configure").val();
  var text = $("#test_decrypt_text").val();

  if(!method){
    alert("Please select method");
    return;
  }

  if(!secretKey){
      alert("Please enter secret key");
      return;
  }

  if(!text){
        alert("Please enter text to decrypt");
        return;
  }

          $("#do_decrypt_test").prop( "disabled", true );
          $("#do_decrypt_test").text("Decrypting..");
          document.getElementById('test_encrypt_text').value = "";
          var conf = { methodName: method, secretKey: secretKey, text:text};
          $.ajax({
              url: baseUrl+'/api/v1/admin/testdecrypt',
              headers: {"Authorization": "Bearer "+token},
              type: 'POST',
              data: JSON.stringify(conf),
              contentType: 'application/json',
              dataType: 'json',
              success: function(msg) {
                   console.log(msg)
                   $("#do_decrypt_test").prop( "disabled", false );
                   $("#do_decrypt_test").text("Decrypt");
                   $("#test_encrypt_text").val(msg.data);
                   document.getElementById('test_encrypt_text').value = msg.data;
              },
              error: function (xhr, exception) {
                  $("#do_decrypt_test").prop( "disabled", false );
                  $("#do_decrypt_test").text("Decrypt");
              }
          });
}

function gemerateKey(){
    var method = $("#method_list_configure").val();
    if(method){
//        if (confirm('Are you sure you want to save this thing into the database?')) {
            $("#do_generate").text("Generating secret key...");
            $("#do_generate").prop( "disabled", true );
            var conf = { methodName:method };
            $.ajax({
                url: baseUrl+'/api/v1/admin/generateKey',
                headers: {"Authorization": "Bearer "+token},
                type: 'POST',
                data: JSON.stringify(conf),
                async: true,
                contentType: 'application/json',
                dataType: 'json',
                success: function(msg) {
                    $("#do_generate").prop( "disabled", false );
                    $("#do_generate").text("Generate Secret Key");
                    console.log(msg);
                    $("#method_secret").val(msg.secretKey)
                    alert("Method key generated successfully");
                },
                    error: function (xhr, exception) {
                    $("#do_generate").prop( "disabled", false );
                    $("#do_generate").text("Generate Secret Key");
                }
            });
//        }
     }else{
        alert("Please select and encryption/decryption method to generate secret key");
     }
}


function configureMethod(){
  var secretKey = $("#method_secret").val();
  var method = $("#method_list_configure").val();
  var isDefault = document.getElementById('is_default').checked
  if(method){
    if(secretKey){
        $("#do_configure").text("Saving...");
        $("#do_configure").prop( "disabled", true );
        var conf = { methodName: $("#method_list_configure").val(), secretKey: secretKey, isDefault: isDefault};
        $.ajax({
            url: baseUrl+'/api/v1/admin/configure',
            headers: {"Authorization": "Bearer "+token},
            type: 'POST',
            data: JSON.stringify(conf),
            async: true,
            contentType: 'application/json',
            dataType: 'json',
            success: function(msg) {
                $("#do_configure").prop( "disabled", false );
                $("#do_configure").text("Save");
                console.log(msg);
                alert("Method configured successfully");
            },
            error: function (xhr, exception) {
                $("#do_configure").prop( "disabled", false );
                $("#do_configure").text("Save");
            }
        });
      }else{
        alert("Please provide secret key");
      }
  }else{
    alert("Please select and encryption/decryption method to configure");
  }
}


function updateEncryptionMethod(){
  let files = [];
  $('.selected_file:checked').each(function () {
     files.push($(this).attr("data-id"));
  });
  if($("#method_list_update").val()){
    if(!$("#select_all_files").is(":checked") && files.length == 0){
      alert("Please select at least one file");
    }else{
      $("#do_update").prop( "disabled", true );
      var update = {
        selectAll : $("#select_all_files").is(":checked"),
        methodName: $("#method_list_update").val(),
        files: files
      }
      $.ajax({
          url: baseUrl+'/api/v1/admin/update',
          headers: {"Authorization": "Bearer "+token},
          type: 'POST',
          async: true,
          data: JSON.stringify(update),
          contentType: 'application/json',
          dataType: 'json',
          success: function(msg) {
              $("#do_update").prop( "disabled", false );
              alert("files successfully updated or queued for update");
              loadFiles();
          }
      });
    }
  }else{
    alert("Please select a method");
  }
}



function loadFiles(){

  let filterValue = $("#search_text").val();

  let url = "/api/v1/admin/lndfiles?page="+page+"&size="+pageSize;
  if(filterValue != ""){
    url = url + "&filterValue="+filterValue;
  }
  var $el = $("#file_body");
  $el.empty();
  var markup = "<tr><td colspan='4'>Loading...</td></tr>";
  $el.append(markup);
  $("#prev_button").addClass( "disabled");
  $("#next_button").addClass( "disabled");
  $.ajax({
      url: baseUrl+url,
      headers: {"Authorization": "Bearer "+token},
      type: 'GET',
      async: true,
      contentType: 'application/json',
      success: function(data) {
        if(data.files.length == 0){
          $el.empty();
          var markup = "<tr><td colspan='4'>No file found for this selection</td></tr>";
          $el.append(markup);
        }else{
          setPagination();
          pageTotal = data.pageNumbers.length;
          $el.empty();
          var markup = "";
          for(var i = 0; i < data.files.length; i++){
            markup+='<tr><td><input type="checkbox" value="'+data.files[i].id+'" class="custom-control-input selected_file" data-id="'+data.files[i].id+'" id="">';
            markup+='<td>'+data.files[i].nodeName+'</td>';
            markup+='<td>'+data.files[i].cipherMethod+'</td>';
            markup+='<td>'+data.files[i].fileName+'</td></tr>';
          }
          $el.append(markup);
        }
      }
  });
}



$('#method_list_configure').on('change', function() {
  $("#method_secret").val("Loading...");
  $("#do_configure").prop( "disabled", true );
  document.getElementById('test_decrypt_text').value = "";
  document.getElementById('test_encrypt_text').value = "";
  $.ajax({
      url: baseUrl+'/api/v1/admin/get/'+this.value,
      headers: {"Authorization": "Bearer "+token},
      type: 'GET',
      async: true,
      contentType: 'application/json',
      success: function(data) {

        $("#do_configure").prop( "disabled", false );
        currentConfigureMethod = data;

        document.getElementById("is_default").checked = data["default"];
        $("#method_secret").val(data.secretKey)
      },
       error: function (xhr, exception) {
            $("#do_configure").prop( "disabled", false );
       }
  });
});

function setPagination(){

 if(page <= 0){
  $("#prev_button").addClass( "disabled");
 }else{
  $("#prev_button").removeClass( "disabled");
 }

 if(page < (pageTotal - 1)){
   $("#next_button").removeClass( "disabled");
 }else{
   $("#next_button").addClass( "disabled");
 }

}
$('#all_none').change(function() {
  var checkboxes = $(this).closest('form').find(':checkbox');
  $('.selected_file').prop('checked', $(this).is(':checked'));
});


$('#do_filter').on('click', function() {
  page = 0;
  loadFiles();
});

$('#do_configure').on('click', function() {
  configureMethod();
});

$('#do_generate').on('click', function() {
  gemerateKey();
});

$('#do_update').on('click', function() {
  updateEncryptionMethod();
});


$('#do_login').on('click', function() {
  doLogin();
});

$('#do_encrypt_test').on('click', function() {
  testEncrypt();
});

$('#do_decrypt_test').on('click', function() {
  testDecrypt();
});

$('#prev_button').on('click', function() {
    if(!$(this).hasClass("disabled")){
        page = page  - 1;
        loadFiles();
    }
});

$('#next_button').on('click', function() {
    if(!$(this).hasClass("disabled")){
        page = page  + 1;
        loadFiles();
    }

});

token = getCookie("token");
if(token != null && token != ""){
  loadOptions();
  $("#application_div").show();
}else{
  $("#login_div").show();
}
