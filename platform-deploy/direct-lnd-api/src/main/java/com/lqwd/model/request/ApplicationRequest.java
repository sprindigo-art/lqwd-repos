package com.lqwd.model.request;

import lombok.Data;

import javax.persistence.Column;
import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

@Data
public class ApplicationRequest {

    @NotBlank
    private String productInfo;
    @NotBlank
    private String goal;
    @NotBlank
    private String currentSolution;
    @NotBlank
    private String companyName;
    @NotBlank
    private String contactName;
    @NotBlank
    private String contactEmail;
    @Size(min = 3, max = 15)
    private String contactPhone;
    @NotBlank
    private String companyAddress;
    @Size(min = 1, max = 2)
    private String countryCode;
    @NotBlank
    @Size(min = 4, max = 10)
    private String zipCode;
    private String companyUrl;
    private boolean hasKyc;
}
