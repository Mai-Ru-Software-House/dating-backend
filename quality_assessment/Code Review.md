# **Code Review Record**

## **1\. Roles**

| Role | Name | Responsibility |
| :---- | :---- | :---- |
| Author ("Committer") | Natdanai (Chuan) | Presents the code with an overview of its intended functionality |
| Reviewer 1 | Suppakorn (Tae) | Points out potential issues; also highlights especially good sections |
| Reviewer 2 | Radit (Vic) | Points out potential issues; also highlights especially good sections |
| Facilitator / Scribe | Kittiphon (Tee) | Records details of feedback; keeps the interaction focused, respectful and productive |

## **2\. Author's overview**

Summary of what the author said the code is supposed to do:

* Purpose: Holds value rules for the profile (for example: name length, etc.)

* Inputs and outputs: 

  * Input: User entered Value (Depends on which field)

  * Output: Return Value (Success), Error Message (Fail)

* Main functions or components:

  * Validate user input (username, password, display name, location, DOB, gender, preference)

  * Normalize valid inputs to be sent to the database

## 

## **3\. Issue log**

Severity: **Major** (wrong behavior or likely defect) or **Minor** (works but should be improved).

| ID | Line(s) | Severity | Description | Raised by | Author response |
| :---- | :---- | :---- | :---- | :---- | :---- |
| 1 | 124 | Minor | Concern over month \-1, what if month \= 1 | Tae | Date.UTC uses month indexes, 0-11. So month \= Jan \= 1 \- 1 \= index 0 which is correct. |
| 2 | 96-108 | Major | Check display name calls function trim to check if it is empty but trim only removes normal space but doesn’t remove invisible characters | Vic | 2 ways to fix. 1, remove the special characters before trim. 2, Create a predefined set of characters that could be invisible. |

## **4\. Especially good sections**

| ID | Line(s) | What is good about it | Raised by |
| :---- | :---- | :---- | :---- |
| 1 | 118-138 | checkDateOfBirth receives now as an argument and does not read the clock itself. This makes the rule easy to test with fixed dates. | Vic |
| 2 | 12-42 | Things that do not need to be exported are kept internally within the code file. | Tae |

## 

## **5\. Annotated code**

Issue 1: Month \- 1

**Lines:** L124 | **Severity:** Minor

*// L124 const date \= new Date(Date.UTC(year, month \- 1, day)); //* Date.UTC uses month indexes, 0-11. So month \= Jan \= 1 \- 1 \= index 0 which is correct.

**Feedback:** No fixes necessary

Issue 2: Trim Concern

**Lines:** 96-108 | **Severity:** Major

//L96 export function checkDisplayName(value: string): string {

//L97  const trimmed \= value.trim();

//L98  if (trimmed \=== "") { 	//trim only removes normal space but doesn’t remove invisible characters

//L99    throw invalid("displayName", "A display name is required.");

//L100  }

//L101  if (characterCount(trimmed) \> MAX\_DISPLAY\_NAME\_LENGTH) {

//L102    throw invalid(

//L103      "displayName",

//L104      \`The display name can have at most \${String(MAX\_DISPLAY\_NAME\_LENGTH)} characters.\`,

//L105  );

//L106   }

//L107  return trimmed;

//L108  }

**Feedback:** To Fix, remove invisible characters before trim

Good section 1: CheckDOB

**Lines:**

//L118 export function checkDateOfBirth(value: string, now: Date): Date {

//L119  const match \= DATE\_PATTERN.exec(value);

//L120  const \[year, month, day\] \= (match?.slice(1) ?? \[\]).map(Number);

//L121  if (year \=== undefined || month \=== undefined || day \=== undefined || year \< MIN\_BIRTH\_YEAR) {

//L122    throw invalid("dateOfBirth", "Enter a real date of birth as YYYY-MM-DD.");

//L123  }

//L124  const date \= new Date(Date.UTC(year, month \- 1, day));

//L125  const isRealDate \=

//L126    date.getUTCFullYear() \=== year && date.getUTCMonth() \=== month \- 1 && date.getUTCDate() \=== day;

//L127  if (\!isRealDate) {

//L128    throw invalid("dateOfBirth", "Enter a real date of birth as YYYY-MM-DD.");

//L129  }

//L130  const today \= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

//L131  if (date.getTime() \> today) {

//L132    throw invalid("dateOfBirth", "The date of birth cannot be in the future.");

//L133  }

//L134  if (ageOn(date, now) \< MIN\_AGE) {

//L135    throw invalid("dateOfBirth", \`You must be at least \${String(MIN\_AGE)} years old.\`);

//L136  }

//L137  return date;

//L138 }

**Why it is good:**

checkDateOfBirth receives now as an argument and does not read the clock itself. This makes the rule easy to test with fixed dates.

Good section 2: Exports

**Lines:**

//L12 const HTTP\_BAD\_REQUEST \= 400;

//L13

//L14 /\*\* A1: 4 to 20 letters, digits and underscore. Stored in lowercase. \*/

//L15 const USERNAME\_PATTERN \= /^\[A-Za-z0-9\_\]{4,20}\$/;

//L16 const USERNAME\_RULE \= "The username must be 4 to 20 characters: letters, digits and underscore.";

//L17 

//L18 /\*\* A2: at least 8 characters with at least one letter and one digit. \*/

//L19 export const MIN\_PASSWORD\_LENGTH \= 8;

//L20 const LETTER\_PATTERN \= /\\p{L}/u;

//L21 const DIGIT\_PATTERN \= /\[0-9\]/;

//L22 const PASSWORD\_RULE \= \`at least \${String(MIN\_PASSWORD\_LENGTH)} characters, with at least one letter and one digit\`;

//L23

//L24 /\*\* The \`users.display\_name\` column holds 50 characters. \*/

//L25 export const MAX\_DISPLAY\_NAME\_LENGTH \= 50;

//L26

//L27 /\*\* A3: the minimum age, for the user and for the preferences. \*/

//L28 export const MIN\_AGE \= 18;

//L29 /\*\* The oldest age a preference can ask for. \*/

//L30 export const MAX\_AGE \= 120;

//L31 /\*\* Dates of birth before this year are treated as typing mistakes. \*/

//L32 const MIN\_BIRTH\_YEAR \= 1900;

//L33 const DATE\_PATTERN \= /^(\\d{4})-(\\d{2})-(\\d{2})\$/;

//L34 

//L35 /\*\* Search radius in whole km. The app's slider sends 1 to 100\. \*/

//L36 export const MIN\_RADIUS\_KM \= 1;

//L37 export const MAX\_RADIUS\_KM \= 20\_000;

//L38

//L39 const MIN\_LATITUDE \= \-90;

//L40 const MAX\_LATITUDE \= 90;

//L41 const MIN\_LONGITUDE \= \-180;

//L42 const MAX\_LONGITUDE \= 180;

**Why it is good:**

Things that do not need to be exported are kept internally within the code file.

