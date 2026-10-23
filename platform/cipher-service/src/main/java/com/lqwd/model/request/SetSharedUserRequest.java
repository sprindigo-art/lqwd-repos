package com.lqwd.model.request;

import lombok.Builder;
import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
@Builder
public class SetSharedUserRequest {

   // @NotBlank
    private String passphrase;

   // @NotBlank
    private String new_passphrase;

   // @NotBlank
    private String sharedUserName;

   // @NotBlank
    private String nodeName;
}
