package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotBlank;

@Data
public class ConfirmLndNodeRequest {

    @NotBlank
    String lndname;

}
