package com.lqwd.model.request;

import com.lqwd.model.Role;
import lombok.Data;

@Data
public class ShareLndRequest {

    private String lndNodeName;

    private String sharedEmail;

    private Role role;

    private int lndNodeId;

    private String sharedUserId;

    private String userId;


    public ShareLndRequest(ShareLndReactRequest shareLndReactRequest) {
        lndNodeName = shareLndReactRequest.getLndNodeName();
        sharedEmail = shareLndReactRequest.getSharedEmail();

    }

    public String getRoleId(){
        return Integer.toString(role.getId());
    }
}
