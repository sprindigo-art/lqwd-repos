package com.lqwd.security.oauth2.model.response;


import com.lqwd.security.oauth2.model.security.Role_;
import lombok.Data;

@Data
public class SharedUsersPermission {
    
    private String userFirstLastName;
    private String email;
    private String nodeName;
    private String alias;
    private String status;
    private Role_ role;

}
