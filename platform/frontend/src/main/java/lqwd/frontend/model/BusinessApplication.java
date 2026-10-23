package lqwd.frontend.model;

import lombok.Getter;
import lombok.Setter;
import org.hibernate.validator.constraints.URL;

import javax.validation.constraints.*;
import java.util.Date;

@Getter
@Setter
public class BusinessApplication {

    @NotBlank(message = "Company Name is Required")
    private String companyName;

    @NotBlank(message = "Company Address is Required")
    private String companyAddress;

    @NotBlank(message = "Company URL is Required")
    private String companyUrl;

    @NotBlank(message = "Contact Email is Required")
    @Email(message = "Must be a Valid Email Address")
    private String contactEmail;

    @NotBlank(message = "Contact Name is Required")
    private String contactName;

    @NotNull(message = "Phone Number is Required")
    @NotBlank(message = "Phone Number is Required")
    private String contactPhone;

    @NotNull(message = "Country Code is Required")
    @Size(max = 2, min = 2, message = "Must Be 2 Characters")
    private String countryCode;

    @NotNull(message = "Zip/Postal is Required")
    @NotBlank(message = "Zip/Postal is Required")
    private String zipCode;

    private String currentSolution;

    private String productInfo;

    private String goal;

    @NotNull(message = "KYC Policy is Required")
    private Boolean hasKyc;

    private Date dateCreated;

    private Date dateModified;


    @Override
    public String toString(){
        return "Business Application\n"+
                "Company Name: " + this.getCompanyName() + "\n"+
                "Contact Name: " + this.getContactName() + "\n"+
                "Contact Email: " + this.getContactEmail() + "\n"+
                "Contact Phone: " + this.getContactPhone() + "\n"+
                "Company Url: " + this.getCompanyUrl() + "\n"+
                "Have KYC Policy: " + this.getHasKyc() + "\n"+
                "Company Address: " + this.getCompanyAddress() + "\n"+
                "Company Postal: " + this.getZipCode() + "\n"+
                "Company Country: " + this.getCountryCode() + "\n"+
                "Current Solution: " + this.getCurrentSolution() + "\n"+
                "Product Information: " + this.getProductInfo() + "\n"+
                "Goal: " + this.getGoal();
    }

}