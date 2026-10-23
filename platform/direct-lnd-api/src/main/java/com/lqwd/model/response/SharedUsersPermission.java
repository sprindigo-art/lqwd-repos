package com.lqwd.model.response;

import com.lqwd.model.Role;
import lombok.Data;

@Data
public class SharedUsersPermission {

    private String userFirstLastName;
    private String email;
    private String nodeName;
    private String alias;
    private String status;
    private Role role;

}
