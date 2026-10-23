package com.lqwd.model.request;

import lombok.Data;

@Data
public class KeysendToEmailRequest {
    private String email;
    private String keySendAddress;
}
