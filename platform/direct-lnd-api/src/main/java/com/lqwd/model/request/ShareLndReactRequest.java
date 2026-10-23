package com.lqwd.model.request;

import com.lqwd.model.Role;
import lombok.Data;
import lombok.NonNull;

@Data
public class ShareLndReactRequest {

//    @NonNull
    private String lndNodeName;

//    @NonNull
    private String sharedEmail;

//    @NonNull
    private String role;

//    @NonNull
    private String passphrase;

//    @NonNull
    private String newPassphrase;

    private String password;
}
